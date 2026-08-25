import { z } from "zod";
import { emailSchema, isoDateTimeSchema, userRoleSchema, uuidSchema } from "./enums";

export const userSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  name: z.string().min(1),
  googleSub: z.string().min(1).nullable(),
  role: userRoleSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type User = z.infer<typeof userSchema>;

export const userInsertSchema = userSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type UserInsert = z.infer<typeof userInsertSchema>;

export const userListResponseSchema = z.object({
  data: z.array(userSchema),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const updateUserRoleBodySchema = z.object({
  role: userRoleSchema,
});
export type UpdateUserRoleBody = z.infer<typeof updateUserRoleBodySchema>;

export const userIdParamsSchema = z.object({
  id: uuidSchema,
});
export type UserIdParams = z.infer<typeof userIdParamsSchema>;
