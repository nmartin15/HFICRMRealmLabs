import {
  complaintRateWatch,
  complaintRateOverGmailLimit,
  currentWeekRange,
  deliverabilityRates,
  deliverabilitySnapshotSchema,
  DISPLAY_TIME_ZONE,
  homeDeliverabilitySchema,
  shiftWeek,
  zonedDayBoundsUtc,
  type CalendarYmd,
  type DeliverabilitySnapshot,
  type HomeDeliverability,
} from "@realm-labs/contracts";
import { emailDeliveryEvents, outboundSends, type Database } from "@realm-labs/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";

function isoToYmd(iso: string): CalendarYmd {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

function weekBounds(start: string, end: string): { startAt: Date; endAt: Date } {
  const startBounds = zonedDayBoundsUtc(isoToYmd(start), DISPLAY_TIME_ZONE);
  const endBounds = zonedDayBoundsUtc(isoToYmd(end), DISPLAY_TIME_ZONE);
  return { startAt: startBounds.start, endAt: endBounds.end };
}

async function countsBetween(
  db: Database,
  startAt: Date,
  endAt: Date,
): Promise<{ sent: number; bounced: number; complained: number }> {
  const [sentRows, bounceRows, complaintRows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(outboundSends)
      .where(
        and(
          eq(outboundSends.status, "sent"),
          eq(outboundSends.isSeed, false),
          gte(outboundSends.sentAt, startAt),
          lt(outboundSends.sentAt, endAt),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(emailDeliveryEvents)
      .where(
        and(
          eq(emailDeliveryEvents.isSeed, false),
          eq(emailDeliveryEvents.recordType, "bounce"),
          gte(emailDeliveryEvents.createdAt, startAt),
          lt(emailDeliveryEvents.createdAt, endAt),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(emailDeliveryEvents)
      .where(
        and(
          eq(emailDeliveryEvents.isSeed, false),
          eq(emailDeliveryEvents.recordType, "complaint"),
          gte(emailDeliveryEvents.createdAt, startAt),
          lt(emailDeliveryEvents.createdAt, endAt),
        ),
      ),
  ]);
  return {
    sent: sentRows[0]?.n ?? 0,
    bounced: bounceRows[0]?.n ?? 0,
    complained: complaintRows[0]?.n ?? 0,
  };
}

export async function loadHomeDeliverability(
  db: Database,
  now: Date,
): Promise<HomeDeliverability> {
  const week = currentWeekRange(now);
  const bounds = weekBounds(week.start, week.end);
  const counts = await countsBetween(db, bounds.startAt, bounds.endAt);
  const rates = deliverabilityRates(counts);
  return homeDeliverabilitySchema.parse({
    weekStart: week.start,
    sent: counts.sent,
    complaintRate: rates.complaintRate,
    bounceRate: rates.bounceRate,
    watch: complaintRateWatch(rates.complaintRate),
  });
}

export async function loadDeliverabilitySnapshot(
  db: Database,
  now: Date,
): Promise<DeliverabilitySnapshot> {
  const thisWeek = currentWeekRange(now);
  const weeks = [];
  let cursor = thisWeek;
  for (let i = 0; i < 8; i += 1) {
    const bounds = weekBounds(cursor.start, cursor.end);
    const counts = await countsBetween(db, bounds.startAt, bounds.endAt);
    const rates = deliverabilityRates(counts);
    weeks.push({
      start: cursor.start,
      end: cursor.end,
      sent: counts.sent,
      bounced: counts.bounced,
      complained: counts.complained,
      bounceRate: rates.bounceRate,
      complaintRate: rates.complaintRate,
    });
    cursor = shiftWeek(cursor, -1);
  }
  const current = weeks[0];
  if (!current) {
    throw new Error("expected a current deliverability week");
  }
  return deliverabilitySnapshotSchema.parse({
    weekStart: current.start,
    weekEnd: current.end,
    sent: current.sent,
    bounced: current.bounced,
    complained: current.complained,
    bounceRate: current.bounceRate,
    complaintRate: current.complaintRate,
    watch: complaintRateWatch(current.complaintRate),
    gmailLimit: complaintRateOverGmailLimit(current.complaintRate),
    weeks,
  });
}
