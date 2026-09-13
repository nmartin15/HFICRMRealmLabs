import {
  CALENDAR_SYNC_QUEUE,
  enqueueCoalescedScoreJob,
  GMAIL_SYNC_QUEUE,
  SCORE_RECOMPUTE_DELAY_MS,
  SCORE_RECOMPUTE_QUEUE,
  scoreRecomputeJobId,
  SYNC_INTERVAL_MS,
  type Mailbox,
  type ScoreRecomputeJobData,
} from "@realm-labs/contracts";
import { Queue } from "bullmq";
import IORedis from "ioredis";

export type SyncQueues = {
  connection: IORedis;
  gmail: Queue;
  calendar: Queue;
  score: Queue;
};

export function createSyncQueues(redisUrl: string): SyncQueues {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  return {
    connection,
    gmail: new Queue(GMAIL_SYNC_QUEUE, { connection }),
    calendar: new Queue(CALENDAR_SYNC_QUEUE, { connection }),
    score: new Queue(SCORE_RECOMPUTE_QUEUE, { connection }),
  };
}

export async function closeSyncQueues(queues: SyncQueues): Promise<void> {
  await Promise.all([
    queues.gmail.close(),
    queues.calendar.close(),
    queues.score.close(),
  ]);
  await queues.connection.quit();
}

export async function enqueueScoreRecompute(
  queues: SyncQueues,
  data: ScoreRecomputeJobData,
  delayMs: number = SCORE_RECOMPUTE_DELAY_MS,
): Promise<void> {
  await enqueueCoalescedScoreJob({
    jobId: scoreRecomputeJobId(data.personId),
    data,
    delayMs,
    getJob: (id) => queues.score.getJob(id),
    add: (name, jobData, opts) => queues.score.add(name, jobData, opts),
  });
}

export async function enqueueMailboxSync(
  queues: SyncQueues,
  mailbox: Mailbox,
): Promise<void> {
  await queues.gmail.add(
    "sync",
    { mailbox },
    {
      jobId: `gmail-${mailbox}-once-${Date.now()}`,
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  await queues.gmail.add(
    "sync",
    { mailbox },
    {
      repeat: { every: SYNC_INTERVAL_MS },
      jobId: `gmail-${mailbox}`,
    },
  );

  await queues.calendar.add(
    "sync",
    { mailbox },
    {
      jobId: `calendar-${mailbox}-once-${Date.now()}`,
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  await queues.calendar.add(
    "sync",
    { mailbox },
    {
      repeat: { every: SYNC_INTERVAL_MS },
      jobId: `calendar-${mailbox}`,
    },
  );
}

export async function removeMailboxSync(
  queues: SyncQueues,
  mailbox: Mailbox,
): Promise<void> {
  await queues.gmail.removeRepeatable("sync", {
    every: SYNC_INTERVAL_MS,
    jobId: `gmail-${mailbox}`,
  });
  await queues.calendar.removeRepeatable("sync", {
    every: SYNC_INTERVAL_MS,
    jobId: `calendar-${mailbox}`,
  });
}
