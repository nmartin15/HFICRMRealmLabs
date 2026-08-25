import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";
import { users } from "./schema";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: resolve(root, ".env") });

async function seed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    throw new Error("ADMIN_EMAIL is required");
  }

  const { db, client } = createDb(databaseUrl);

  try {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);

    if (existing[0]) {
      console.log(`Admin user already exists: ${adminEmail}`);
      return;
    }

    await db.insert(users).values({
      email: adminEmail,
      name: "Admin",
      role: "admin",
    });

    console.log(`Seeded admin user: ${adminEmail}`);
  } finally {
    await client.end();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
