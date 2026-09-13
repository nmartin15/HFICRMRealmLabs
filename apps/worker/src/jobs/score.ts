import { scoreRecomputeJobDataSchema } from "@realm-labs/contracts";
import type { Database } from "@realm-labs/db";
import type { Env } from "../env.js";
import { nightlyScoreAll, runScore } from "../lib/score-adapter.js";

export async function runScoreRecompute(
  db: Database,
  env: Env,
  rawData: unknown,
): Promise<void> {
  const data = scoreRecomputeJobDataSchema.parse(rawData);
  await runScore(db, env, {
    personId: data.personId,
    asOf: new Date(),
    trigger: data.trigger,
    mode: "commit",
    computedBy: data.computedBy ?? null,
  });
}

export async function runNightlyScore(db: Database, env: Env): Promise<void> {
  await nightlyScoreAll(db, env, new Date());
}
