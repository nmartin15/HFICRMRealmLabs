import {
  planCreateTask,
  planManualApplicant,
  planRecruiterSource,
  todayIsoInDisplayZone,
  type ApplicantPipeline,
  type CreateApplicantPersonBody,
  type CreateApplicantResponse,
  type PlanManualApplicantExisting,
} from "@realm-labs/contracts";
import { eq } from "drizzle-orm";
import {
  allocationCards,
  findPersonByEmail,
  incubatorCards,
  people,
  tasks,
  type Database,
} from "@realm-labs/db";
import type { AuthedUser } from "../plugins/auth.js";
import { httpError } from "../plugins/error.js";
import { writeActivity } from "./activity.js";
import { loadSourceRecruiterTarget } from "./recruiters.js";
import { suppressionReasonForEmail, writeSuppression } from "./suppression.js";

type ApplicantBody = CreateApplicantPersonBody & {
  applicationRef?: string;
  programTrack: CreateApplicantPersonBody["programTrack"];
};

function nullable(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createManualApplicant(
  db: Database,
  actor: AuthedUser,
  pipeline: ApplicantPipeline,
  body: ApplicantBody,
  emailHashKey: string,
): Promise<CreateApplicantResponse> {
  const email = body.email;
  const existingPerson = await findPersonByEmail(db, email);

  let existing: PlanManualApplicantExisting | null = null;
  if (existingPerson) {
    const [allocRows, incubRows] = await Promise.all([
      db
        .select({ id: allocationCards.id })
        .from(allocationCards)
        .where(eq(allocationCards.personId, existingPerson.id))
        .limit(1),
      db
        .select({ id: incubatorCards.id })
        .from(incubatorCards)
        .where(eq(incubatorCards.personId, existingPerson.id))
        .limit(1),
    ]);
    existing = {
      id: existingPerson.id,
      doNotContact: existingPerson.doNotContact,
      deleted: Boolean(existingPerson.deletedAt),
      hasAllocationCard: Boolean(allocRows[0]),
      hasIncubatorCard: Boolean(incubRows[0]),
      contactKind: existingPerson.contactKind,
    };
  }

  const plan = planManualApplicant({
    programTrack: body.programTrack,
    name: body.name,
    existing,
    applicationRef: body.applicationRef,
    suppressed: Boolean(
      await suppressionReasonForEmail(db, email, emailHashKey),
    ),
  });
  if (!plan.ok) {
    throw httpError(plan.status, plan.code, plan.message);
  }

  const sourcePlan = planRecruiterSource({
    source: body.source,
    sourceRecruiterId: body.sourceRecruiterId,
    personId: plan.reusePersonId,
    target: await loadSourceRecruiterTarget(db, body.sourceRecruiterId),
  });
  if (!sourcePlan.ok) {
    throw httpError(sourcePlan.status, sourcePlan.code, sourcePlan.message);
  }

  const when = new Date();
  const appliedAt = body.appliedAt ?? todayIsoInDisplayZone(when);
  const who = { id: actor.id, email: actor.email };

  return db.transaction(async (tx) => {
    const typedTx = tx as unknown as Database;
    let personId: string;
    const reusedPerson = Boolean(plan.reusePersonId);

    if (plan.reusePersonId && existingPerson) {
      personId = existingPerson.id;
      if (plan.restoreDeleted) {
        await tx
          .update(people)
          .set({ deletedAt: null })
          .where(eq(people.id, personId));
      }
    } else {
      const [created] = await tx
        .insert(people)
        .values({
          firstName: plan.firstName,
          lastName: plan.lastName,
          email,
          title: nullable(body.title),
          company: nullable(body.company),
          location: nullable(body.location),
          source: sourcePlan.source,
          sourceRecruiterId: sourcePlan.sourceRecruiterId,
          appliedAt,
          programTrack: body.programTrack,
        })
        .returning();
      if (!created) {
        throw httpError(500, "INTERNAL", "Failed to create person");
      }
      personId = created.id;

      await writeActivity(typedTx, {
        personId,
        userId: actor.id,
        type: "field_change",
        payload: {
          who,
          what: "person.create",
          when: when.toISOString(),
          before: null,
          after: {
            programTrack: body.programTrack,
            email,
            source: sourcePlan.source,
            sourceRecruiterId: sourcePlan.sourceRecruiterId,
          },
        },
      });
    }

    let cardId: string | null = null;
    if (plan.allocationStage) {
      const [card] = await tx
        .insert(allocationCards)
        .values({
          personId,
          stage: plan.allocationStage,
        })
        .returning();
      if (!card) {
        throw httpError(500, "INTERNAL", "Failed to create allocation card");
      }
      cardId = card.id;
      await writeActivity(typedTx, {
        personId,
        userId: actor.id,
        type: "stage_change",
        payload: {
          who,
          what: "allocation.stage_change",
          when: when.toISOString(),
          before: null,
          after: { stage: plan.allocationStage, source: "manual" },
        },
      });
    } else if (plan.incubatorStage) {
      const [card] = await tx
        .insert(incubatorCards)
        .values({
          personId,
          stage: plan.incubatorStage,
          applicationRef: plan.applicationRef,
          routedAt: when,
        })
        .returning();
      if (!card) {
        throw httpError(500, "INTERNAL", "Failed to create incubator card");
      }
      cardId = card.id;
      await writeActivity(typedTx, {
        personId,
        userId: actor.id,
        type: "stage_change",
        payload: {
          who,
          what: "incubator.stage_change",
          when: when.toISOString(),
          before: null,
          after: { stage: plan.incubatorStage, source: "manual" },
        },
      });
    }

    if (plan.reusePersonId && existingPerson) {
      const reuseUpdate: {
        programTrack?: typeof body.programTrack;
        source?: typeof sourcePlan.source;
        sourceRecruiterId?: typeof sourcePlan.sourceRecruiterId;
      } = {};
      if (existingPerson.programTrack !== body.programTrack) {
        reuseUpdate.programTrack = body.programTrack;
      }
      if (
        existingPerson.source !== sourcePlan.source ||
        existingPerson.sourceRecruiterId !== sourcePlan.sourceRecruiterId
      ) {
        reuseUpdate.source = sourcePlan.source;
        reuseUpdate.sourceRecruiterId = sourcePlan.sourceRecruiterId;
      }
      if (Object.keys(reuseUpdate).length > 0) {
        await tx
          .update(people)
          .set(reuseUpdate)
          .where(eq(people.id, personId));
      }
    }

    const personDoNotContact = Boolean(existingPerson?.doNotContact);
    if (!personDoNotContact) {
      const taskPlan = planCreateTask({
        kind: body.firstTask.kind,
        notes: body.firstTask.notes,
        personDoNotContact: false,
        personDeleted: false,
      });
      if (!taskPlan.ok) {
        throw httpError(taskPlan.status, taskPlan.code, taskPlan.message);
      }
      await tx.insert(tasks).values({
        personId,
        kind: taskPlan.kind,
        dueAt: new Date(body.firstTask.dueAt),
        notes: taskPlan.notes,
        status: taskPlan.kind === "dnc" ? "done" : "open",
        outcome: taskPlan.kind === "meeting" ? "scheduled" : null,
        createdBy: actor.id,
      });
      if (taskPlan.setDoNotContact) {
        await writeSuppression(typedTx, {
          email,
          keyHex: emailHashKey,
          reason: "do_not_contact",
          source: "operator",
          occurredAt: when,
          createdBy: actor.id,
          actorEmail: actor.email,
          personId,
        });
      }
      await writeActivity(typedTx, {
        personId,
        userId: actor.id,
        type: "note",
        payload: {
          who,
          what: "task.create",
          when: when.toISOString(),
          before: null,
          after: {
            kind: taskPlan.kind,
            notes: taskPlan.notes,
            dueAt: body.firstTask.dueAt,
          },
        },
      });
    }

    return { personId, cardId, reusedPerson };
  });
}
