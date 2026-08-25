import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): { db: Database; client: Sql } {
  const client = postgres(url);
  const db = drizzle(client, { schema });
  return { db, client };
}
