import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@realm-labs/db";
import { loadEnv } from "../env.js";
import { dryRunAll } from "../lib/score-adapter.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
config({ path: resolve(root, ".env"), override: true });

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);
const asOf = new Date();
const report = await dryRunAll(db, env, asOf);

console.log(
  JSON.stringify(
    {
      asOf: report.asOf,
      total: report.total,
      skipped: report.skipped,
      components: report.components,
      caps: report.caps,
      byBucket: report.byBucket,
      recentBySource: report.recentBySource,
      recentHandMarks: report.recentHandMarks,
      recentDisagreements: report.recentDisagreements,
      recentDrops: report.recentDrops,
      recentRises: report.recentRises,
      recentDisagreeRate: report.recentDisagreeRate,
      insufficientRecentMarks: report.insufficientRecentMarks,
      weightsWrong: report.weightsWrong,
      calibrationBySource: report.calibrationBySource,
      calibrationHandMarks: report.calibrationHandMarks,
      calibrationDisagreements: report.calibrationDisagreements,
      calibrationDisagreeRate: report.calibrationDisagreeRate,
      handRead: report.handRead,
      drops: report.drops,
      dropAge: report.dropAge,
      rises: report.rises,
      hysteresisSeeds: report.hysteresisSeeds,
      nullManual: report.nullManual,
      disagreements: report.disagreements,
    },
    null,
    2,
  ),
);

await client.end({ timeout: 5 });
