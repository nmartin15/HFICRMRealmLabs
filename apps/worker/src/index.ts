import { Worker } from "bullmq";
import { config } from "dotenv";
import IORedis from "ioredis";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALENDAR_SYNC_QUEUE,
  GMAIL_SYNC_QUEUE,
} from "@realm-labs/contracts";
import { createDb, mailboxConnections } from "@realm-labs/db";
import { loadEnv } from "./env.js";
import { createHealthServer } from "./health.js";
import { runCalendarSync, runGmailSync } from "./jobs/sync.js";
import { createQueues, scheduleMailboxSync } from "./schedule.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(root, ".env"), override: true });

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);

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
    await runGmailSync(db, env, job.data);
  },
  { connection, concurrency: 1 },
);

const calendarWorker = new Worker(
  CALENDAR_SYNC_QUEUE,
  async (job) => {
    await runCalendarSync(db, env, job.data);
  },
  { connection, concurrency: 1 },
);

gmailWorker.on("failed", (job, error) => {
  console.error(`gmail.sync ${job?.id ?? "unknown"} failed`, error);
});

calendarWorker.on("failed", (job, error) => {
  console.error(`calendar.sync ${job?.id ?? "unknown"} failed`, error);
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
  await scheduleMailboxSync(queues, row.mailbox);
  console.log(`Scheduled sync for ${row.mailbox} mailbox`);
}

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    healthServer.close((err) => (err ? reject(err) : resolve()));
  });
  await gmailWorker.close();
  await calendarWorker.close();
  await queues.gmail.close();
  await queues.calendar.close();
  await connection.quit();
  await client.end({ timeout: 5 });
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
