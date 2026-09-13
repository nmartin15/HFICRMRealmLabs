import { Worker } from "bullmq";
import { config } from "dotenv";
import IORedis from "ioredis";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALENDAR_SYNC_QUEUE,
  GMAIL_SYNC_QUEUE,
  OUTBOUND_SEND_QUEUE,
  SCORE_RECOMPUTE_QUEUE,
  isConfiguredMailbox,
} from "@realm-labs/contracts";
import { createDb, ensureEmailHashKeyFingerprint, mailboxConnections } from "@realm-labs/db";
import { loadEnv } from "./env.js";
import { createHealthServer } from "./health.js";
import { runCalendarSync, runGmailSync } from "./jobs/sync.js";
import { runNightlyScore, runScoreRecompute } from "./jobs/score.js";
import { runOutboundDrain } from "./jobs/send.js";
import { fireAlert } from "./lib/alert.js";
import {
  createQueues,
  enqueueScoreRecompute,
  scheduleMailboxSync,
  scheduleNightlyScore,
  scheduleOutboundDrain,
} from "./schedule.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(root, ".env"), override: true });

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);
await ensureEmailHashKeyFingerprint(db, env.EMAIL_HASH_KEY);

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

connection.on("connect", () => {
  console.log("Worker connected to Redis");
});

connection.on("error", (error: Error) => {
  console.error("Redis connection error", error);
});

const queues = createQueues(connection);

const gmailWorker = new Worker(
  GMAIL_SYNC_QUEUE,
  async (job) => {
    await runGmailSync(db, env, job.data, {
      enqueueScore: (input) =>
        enqueueScoreRecompute(queues, {
          personId: input.personId,
          trigger: input.trigger,
          computedBy: null,
        }),
    });
  },
  { connection, concurrency: 1 },
);

const calendarWorker = new Worker(
  CALENDAR_SYNC_QUEUE,
  async (job) => {
    await runCalendarSync(db, env, job.data, {
      enqueueScore: (input) =>
        enqueueScoreRecompute(queues, {
          personId: input.personId,
          trigger: input.trigger,
          computedBy: null,
        }),
    });
  },
  { connection, concurrency: 1 },
);

const scoreWorker = new Worker(
  SCORE_RECOMPUTE_QUEUE,
  async (job) => {
    if (job.name === "nightly") {
      await runNightlyScore(db, env);
      return;
    }
    await runScoreRecompute(db, env, job.data);
  },
  { connection, concurrency: 1 },
);

const outboundWorker = new Worker(
  OUTBOUND_SEND_QUEUE,
  async () => {
    await runOutboundDrain(db, env);
  },
  { connection, concurrency: 1 },
);

gmailWorker.on("failed", (job, error) => {
  void fireAlert(
    env,
    `gmail.sync ${job?.id ?? "unknown"} failed ${error instanceof Error ? error.message : "unknown"}`,
  );
});

calendarWorker.on("failed", (job, error) => {
  void fireAlert(
    env,
    `calendar.sync ${job?.id ?? "unknown"} failed ${error instanceof Error ? error.message : "unknown"}`,
  );
});

scoreWorker.on("failed", (job, error) => {
  void fireAlert(
    env,
    `score.recompute ${job?.id ?? "unknown"} failed ${error instanceof Error ? error.message : "unknown"}`,
  );
});

outboundWorker.on("failed", (job, error) => {
  void fireAlert(
    env,
    `outbound.drain ${job?.id ?? "unknown"} failed ${error instanceof Error ? error.message : "unknown"}`,
  );
});

const envPort = Number.parseInt(process.env.PORT ?? "", 10);
const healthPort =
  Number.isFinite(envPort) && envPort > 0 ? envPort : env.WORKER_HEALTH_PORT;
const healthServer = createHealthServer();
await new Promise<void>((resolve, reject) => {
  const onError = (err: Error) => reject(err);
  healthServer.once("error", onError);
  healthServer.listen(healthPort, "0.0.0.0", () => {
    healthServer.off("error", onError);
    resolve();
  });
});
console.log(`Worker health listening on ${healthPort}`);

const connections = await db.select().from(mailboxConnections);
for (const row of connections) {
  if (!isConfiguredMailbox(row.mailbox)) {
    continue;
  }
  await scheduleMailboxSync(queues, row.mailbox);
  console.log(`Scheduled sync for ${row.mailbox} mailbox`);
}
await scheduleNightlyScore(queues);
console.log("Scheduled nightly score pass");
await scheduleOutboundDrain(queues);
console.log("Scheduled outbound send drain");

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    healthServer.close((err) => (err ? reject(err) : resolve()));
  });
  await gmailWorker.close();
  await calendarWorker.close();
  await scoreWorker.close();
  await outboundWorker.close();
  await queues.gmail.close();
  await queues.calendar.close();
  await queues.score.close();
  await queues.outbound.close();
  await connection.quit();
  await client.end({ timeout: 5 });
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
