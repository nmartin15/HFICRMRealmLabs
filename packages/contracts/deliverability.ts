import { z } from "zod";
import { isoDateSchema } from "./enums";
import {
  COMPLAINT_RATE_GMAIL_LIMIT,
  COMPLAINT_RATE_WATCH,
} from "./send";

export type DeliverabilityCounts = {
  sent: number;
  bounced: number;
  complained: number;
};

export function deliverabilityRates(input: DeliverabilityCounts): {
  bounceRate: number;
  complaintRate: number;
} {
  if (input.sent <= 0) {
    return { bounceRate: 0, complaintRate: 0 };
  }
  return {
    bounceRate: input.bounced / input.sent,
    complaintRate: input.complained / input.sent,
  };
}

export function complaintRateWatch(complaintRate: number): boolean {
  return complaintRate >= COMPLAINT_RATE_WATCH;
}

export function complaintRateOverGmailLimit(complaintRate: number): boolean {
  return complaintRate >= COMPLAINT_RATE_GMAIL_LIMIT;
}

export type OutboundDrainHalt =
  | { halt: false }
  | { halt: true; reason: "complaint_gmail_limit" };

export function planOutboundDrainRelease(
  complaintRate: number,
): OutboundDrainHalt {
  if (complaintRateOverGmailLimit(complaintRate)) {
    return { halt: true, reason: "complaint_gmail_limit" };
  }
  return { halt: false };
}

export const deliverabilityWeekSchema = z.object({
  start: isoDateSchema,
  end: isoDateSchema,
  sent: z.number().int().nonnegative(),
  bounced: z.number().int().nonnegative(),
  complained: z.number().int().nonnegative(),
  bounceRate: z.number().nonnegative(),
  complaintRate: z.number().nonnegative(),
});
export type DeliverabilityWeek = z.infer<typeof deliverabilityWeekSchema>;

export const deliverabilitySnapshotSchema = z.object({
  weekStart: isoDateSchema,
  weekEnd: isoDateSchema,
  sent: z.number().int().nonnegative(),
  bounced: z.number().int().nonnegative(),
  complained: z.number().int().nonnegative(),
  bounceRate: z.number().nonnegative(),
  complaintRate: z.number().nonnegative(),
  watch: z.boolean(),
  gmailLimit: z.boolean(),
  weeks: z.array(deliverabilityWeekSchema),
});
export type DeliverabilitySnapshot = z.infer<
  typeof deliverabilitySnapshotSchema
>;

export const homeDeliverabilitySchema = z.object({
  weekStart: isoDateSchema,
  sent: z.number().int().nonnegative(),
  complaintRate: z.number().nonnegative(),
  bounceRate: z.number().nonnegative(),
  watch: z.boolean(),
});
export type HomeDeliverability = z.infer<typeof homeDeliverabilitySchema>;
