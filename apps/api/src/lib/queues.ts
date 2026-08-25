import {
  CALENDAR_SYNC_QUEUE,
  GMAIL_SYNC_QUEUE,
  SYNC_INTERVAL_MS,
  type Mailbox,
} from "@realm-labs/contracts";
import { Queue } from "bullmq";
import IORedis from "ioredis";

export type SyncQueues = {
  connection: IORedis;
  gmail: Queue;
  calendar: Queue;
};

export function createSyncQueues(redisUrl: string): SyncQueues {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  return {
    connection,
    gmail: new Queue(GMAIL_SYNC_QUEUE, { connection }),
    calendar: new Queue(CALENDAR_SYNC_QUEUE, { connection }),
  };
}

export async function closeSyncQueues(queues: SyncQueues): Promise<void> {
  await Promise.all([queues.gmail.close(), queues.calendar.close()]);
  await queues.connection.quit();
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

  if (mailbox === "personal") {
    await queues.calendar.add(
      "sync",
      { mailbox: "personal" as const },
      {
        jobId: `calendar-personal-once-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );
    await queues.calendar.add(
      "sync",
      { mailbox: "personal" as const },
      {
        repeat: { every: SYNC_INTERVAL_MS },
        jobId: "calendar-personal",
      },
    );
  }
}

export async function removeMailboxSync(
  queues: SyncQueues,
  mailbox: Mailbox,
): Promise<void> {
  await queues.gmail.removeRepeatable("sync", {
    every: SYNC_INTERVAL_MS,
    jobId: `gmail-${mailbox}`,
  });
  if (mailbox === "personal") {
    await queues.calendar.removeRepeatable("sync", {
      every: SYNC_INTERVAL_MS,
      jobId: "calendar-personal",
    });
  }
}
