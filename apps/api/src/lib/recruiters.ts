import type { SourceRecruiterTarget } from "@realm-labs/contracts";
import { eq } from "drizzle-orm";
import { people, type Database } from "@realm-labs/db";
import type { SourceRecruiterRow } from "./serialize.js";

export async function loadSourceRecruiterTarget(
  db: Database,
  id: string | null | undefined,
): Promise<SourceRecruiterTarget | null> {
  if (!id) {
    return null;
  }
  const rows = await db
    .select({
      id: people.id,
      contactKind: people.contactKind,
      deletedAt: people.deletedAt,
    })
    .from(people)
    .where(eq(people.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    contactKind: row.contactKind,
    deleted: Boolean(row.deletedAt),
  };
}

export async function loadSourceRecruiterSummary(
  db: Database,
  id: string | null | undefined,
): Promise<SourceRecruiterRow | null> {
  if (!id) {
    return null;
  }
  const rows = await db
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      recruiterSpecialty: people.recruiterSpecialty,
    })
    .from(people)
    .where(eq(people.id, id))
    .limit(1);
  return rows[0] ?? null;
}
