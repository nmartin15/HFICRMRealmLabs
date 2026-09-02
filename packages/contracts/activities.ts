import { z } from "zod";
import {
  activityTypeSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./enums";

export const activityPayloadSchema = z.record(z.string(), z.unknown());
export type ActivityPayload = z.infer<typeof activityPayloadSchema>;

export const activitySchema = z.object({
  id: uuidSchema,
  personId: uuidSchema.nullable(),
  userId: uuidSchema.nullable(),
  type: activityTypeSchema,
  payload: activityPayloadSchema,
  occurredAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Activity = z.infer<typeof activitySchema>;

export const activityInsertSchema = activitySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ActivityInsert = z.infer<typeof activityInsertSchema>;
