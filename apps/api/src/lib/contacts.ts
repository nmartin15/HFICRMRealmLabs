import {
  planCreateTask,
  planManualContact,
  planContactKindChange,
  planRecruiterSource,
  type CreatePersonBody,
  type CreatePersonResponse,
  type PlanManualContactExisting,
} from "@realm-labs/contracts";
import { eq } from "drizzle-orm";
import { findPersonByEmail, people, tasks, type Database } from "@realm-labs/db";
import type { AuthedUser } from "../plugins/auth.js";
import { httpError } from "../plugins/error.js";
import { writeActivity } from "./activity.js";
import { loadSourceRecruiterTarget } from "./recruiters.js";
import { suppressionReasonForEmail, writeSuppression } from "./suppression.js";

function nullable(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createManualContact(
  db: Database,
  actor: AuthedUser,
  body: CreatePersonBody,
  emailHashKey: string,
): Promise<CreatePersonResponse> {
  const existingPerson = await findPersonByEmail(db, body.email);

  let existing: PlanManualContactExisting | null = null;
  if (existingPerson) {
    existing = {
      id: existingPerson.id,
      doNotContact: existingPerson.doNotContact,
      deleted: Boolean(existingPerson.deletedAt),
    };
  }

  const suppressed = Boolean(
    await suppressionReasonForEmail(db, body.email, emailHashKey),
  );
  const plan = planManualContact({
    name: body.name,
    existing,
    suppressed,
  });
  if (!plan.ok) {
    throw httpError(plan.status, plan.code, plan.message);
  }

  const kindPlan = planContactKindChange({
    contactKind: body.contactKind,
    recruiterSpecialty: body.recruiterSpecialty,
    programTrack: null,
    hasBoardCard: false,
    source: body.source,
  });
  if (!kindPlan.ok) {
    throw httpError(kindPlan.status, kindPlan.code, kindPlan.message);
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
  const who = { id: actor.id, email: actor.email };

  return db.transaction(async (tx) => {
    const typedTx = tx as unknown as Database;
    let personId: string;
    const reusedPerson = Boolean(plan.reusePersonId);

    if (plan.reusePersonId && existingPerson) {
      personId = existingPerson.id;
      await tx
        .update(people)
        .set({
          firstName: plan.firstName,
          lastName: plan.lastName,
          deletedAt: null,
          title: nullable(body.title) ?? existingPerson.title,
          company: nullable(body.company) ?? existingPerson.company,
          location: nullable(body.location) ?? existingPerson.location,
          source: sourcePlan.source,
          sourceRecruiterId: sourcePlan.sourceRecruiterId,
          contactKind: kindPlan.contactKind,
          recruiterSpecialty: kindPlan.recruiterSpecialty,
          notes: nullable(body.notes) ?? existingPerson.notes,
          ownerId: existingPerson.ownerId ?? actor.id,
        })
        .where(eq(people.id, personId));

      await writeActivity(typedTx, {
        personId,
        userId: actor.id,
        type: "field_change",
        payload: {
          who,
          what: "person.create",
          when: when.toISOString(),
          before: { deletedAt: existingPerson.deletedAt?.toISOString() ?? null },
          after: { email: body.email, restored: true },
        },
      });
    } else {
      const [created] = await tx
        .insert(people)
        .values({
          firstName: plan.firstName,
          lastName: plan.lastName,
          email: body.email,
          title: nullable(body.title),
          company: nullable(body.company),
          location: nullable(body.location),
          source: sourcePlan.source,
          sourceRecruiterId: sourcePlan.sourceRecruiterId,
          contactKind: kindPlan.contactKind,
          recruiterSpecialty: kindPlan.recruiterSpecialty,
          notes: nullable(body.notes),
          programTrack: null,
          ownerId: actor.id,
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
            email: body.email,
            programTrack: null,
            contactKind: kindPlan.contactKind,
            recruiterSpecialty: kindPlan.recruiterSpecialty,
            source: sourcePlan.source,
            sourceRecruiterId: sourcePlan.sourceRecruiterId,
          },
        },
      });
    }

    if (body.firstTask) {
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
          email: body.email,
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

    return { personId, reusedPerson };
  });
}
