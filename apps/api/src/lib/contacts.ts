import {
  planCreateTask,
  planManualContact,
  type CreatePersonBody,
  type CreatePersonResponse,
  type PlanManualContactExisting,
} from "@realm-labs/contracts";
import { eq } from "drizzle-orm";
import { people, tasks, type Database } from "@realm-labs/db";
import type { AuthedUser } from "../plugins/auth.js";
import { httpError } from "../plugins/error.js";
import { writeActivity } from "./activity.js";

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
): Promise<CreatePersonResponse> {
  const existingRows = await db
    .select()
    .from(people)
    .where(eq(people.email, body.email))
    .limit(1);
  const existingPerson = existingRows[0] ?? null;

  let existing: PlanManualContactExisting | null = null;
  if (existingPerson) {
    existing = {
      id: existingPerson.id,
      doNotContact: existingPerson.doNotContact,
      deleted: Boolean(existingPerson.deletedAt),
    };
  }

  const plan = planManualContact({
    name: body.name,
    existing,
  });
  if (!plan.ok) {
    throw httpError(plan.status, plan.code, plan.message);
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
          source: body.source,
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
          source: body.source,
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
          after: { email: body.email, programTrack: null },
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
        await tx
          .update(people)
          .set({ doNotContact: true, programTrack: null })
          .where(eq(people.id, personId));
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
