import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@realm-labs/db";
import { loadEnv } from "../env.js";
import { inspectWarmestPerson } from "../lib/score-adapter.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
config({ path: resolve(root, ".env"), override: true });

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);
const asOf = new Date();
const email = process.argv[2];
const report = await inspectWarmestPerson(db, env, asOf, email);

function iso(at: number): string {
  return new Date(at).toISOString();
}

const focus = report.focus;
console.log(
  JSON.stringify(
    {
      asOf: asOf.toISOString(),
      roster: report.roster,
      focus: focus
        ? {
            personId: focus.personId,
            email: focus.email,
            name: focus.name,
            leadTemp: focus.leadTemp,
            budgetQualified: focus.budgetQualified,
            programTrack: focus.programTrack,
            score: focus.score,
            bucket: focus.bucket,
            holdSummary: focus.holdSummary,
            firstRun: focus.firstRun,
            crmHasEvents: focus.crmHasEvents,
            loaderDroppedEvents: focus.loaderDroppedEvents,
            raw: focus.raw,
            facts: {
              ...focus.facts,
              conversations: focus.facts.conversations.map((row) => ({
                kind: row.kind,
                at: iso(row.at),
              })),
              inboundReplies: focus.facts.inboundReplies.map((row) => ({
                at: iso(row.at),
              })),
              operatorTemp: focus.facts.operatorTemp
                ? {
                    level: focus.facts.operatorTemp.level,
                    at: iso(focus.facts.operatorTemp.at),
                  }
                : null,
              asOf: iso(focus.facts.asOf),
            },
            components: focus.components,
          }
        : null,
    },
    null,
    2,
  ),
);

await client.end({ timeout: 5 });
