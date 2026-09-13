import { eq, inArray } from "drizzle-orm";
import type { Database } from "./client";
import { people, personEmails } from "./schema";

export async function findPersonByEmail(db: Database, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const primary = await db
    .select()
    .from(people)
    .where(eq(people.email, normalized))
    .limit(1);
  if (primary[0]) {
    return primary[0];
  }
  const alt = await db
    .select({ person: people })
    .from(personEmails)
    .innerJoin(people, eq(personEmails.personId, people.id))
    .where(eq(personEmails.email, normalized))
    .limit(1);
  return alt[0]?.person ?? null;
}

export async function listAlternateEmailsByPerson(
  db: Database,
  personIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byPerson = new Map<string, string[]>();
  if (personIds.length === 0) {
    return byPerson;
  }
  const rows = await db
    .select({
      personId: personEmails.personId,
      email: personEmails.email,
    })
    .from(personEmails)
    .where(inArray(personEmails.personId, [...personIds]));
  for (const row of rows) {
    const list = byPerson.get(row.personId) ?? [];
    list.push(row.email);
    byPerson.set(row.personId, list);
  }
  return byPerson;
}
