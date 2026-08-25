import {
  CALENDAR_SYNC_QUEUE,
  GMAIL_SYNC_QUEUE,
  SYNC_INTERVAL_MS,
  type Mailbox,
} from "@realm-labs/contracts";
import { Queue } from "bullmq";
import type IORedis from "ioredis";

export function createQueues(connection: IORedis) {
  return {
    gmail: new Queue(GMAIL_SYNC_QUEUE, { connection }),
    calendar: new Queue(CALENDAR_SYNC_QUEUE, { connection }),
  };
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

  if (mailbox === "personal") {
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
