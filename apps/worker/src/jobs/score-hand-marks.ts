import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@realm-labs/db";
import { loadEnv } from "../env.js";
import { countHandMarks } from "../lib/score-adapter.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
config({ path: resolve(root, ".env"), override: true });

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);
const asOf = new Date();
const report = await countHandMarks(db, asOf);

console.log(JSON.stringify(report, null, 2));

await client.end({ timeout: 5 });
