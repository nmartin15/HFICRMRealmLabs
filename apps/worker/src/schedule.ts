import {
  CALENDAR_SYNC_QUEUE,
  DISPLAY_TIME_ZONE,
  enqueueCoalescedScoreJob,
  GMAIL_SYNC_QUEUE,
  OUTBOUND_SEND_JOB_ID,
  OUTBOUND_SEND_QUEUE,
  SCORE_NIGHTLY_JOB_ID,
  SCORE_RECOMPUTE_DELAY_MS,
  SCORE_RECOMPUTE_QUEUE,
  scoreRecomputeJobId,
  SEND_TICK_MINUTES,
  SYNC_INTERVAL_MS,
  type Mailbox,
  type ScoreRecomputeJobData,
} from "@realm-labs/contracts";
import { Queue } from "bullmq";
import type IORedis from "ioredis";

export function createQueues(connection: IORedis) {
  return {
    gmail: new Queue(GMAIL_SYNC_QUEUE, { connection }),
    calendar: new Queue(CALENDAR_SYNC_QUEUE, { connection }),
    score: new Queue(SCORE_RECOMPUTE_QUEUE, { connection }),
    outbound: new Queue(OUTBOUND_SEND_QUEUE, { connection }),
  };
}

export async function enqueueScoreRecompute(
  queues: ReturnType<typeof createQueues>,
  data: ScoreRecomputeJobData,
): Promise<void> {
  await enqueueCoalescedScoreJob({
    jobId: scoreRecomputeJobId(data.personId),
    data,
    delayMs: SCORE_RECOMPUTE_DELAY_MS,
    getJob: (id) => queues.score.getJob(id),
    add: (name, jobData, opts) => queues.score.add(name, jobData, opts),
  });
}

export async function scheduleNightlyScore(
  queues: ReturnType<typeof createQueues>,
): Promise<void> {
  await queues.score.add(
    "nightly",
    { trigger: "nightly" },
    {
      repeat: { pattern: "0 0 * * *", tz: DISPLAY_TIME_ZONE },
      jobId: SCORE_NIGHTLY_JOB_ID,
    },
  );
}

export async function scheduleOutboundDrain(
  queues: ReturnType<typeof createQueues>,
): Promise<void> {
  await queues.outbound.add(
    "drain",
    {},
    {
      repeat: { every: SEND_TICK_MINUTES * 60 * 1000 },
      jobId: OUTBOUND_SEND_JOB_ID,
    },
  );
}

export async function scheduleMailboxSync(
  queues: ReturnType<typeof createQueues>,
  mailbox: Mailbox,
): Promise<void> {
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
      repeat: { every: SYNC_INTERVAL_MS },
      jobId: `calendar-${mailbox}`,
    },
  );
}
