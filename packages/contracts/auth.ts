import { z } from "zod";
import { userSchema } from "./users";

export const sessionCookieName = "rl_session";

export const authProvidersResponseSchema = z.object({
  google: z.boolean(),
});
export type AuthProvidersResponse = z.infer<typeof authProvidersResponseSchema>;

export const googleStartResponseSchema = z.object({
  url: z.url(),
});
export type GoogleStartResponse = z.infer<typeof googleStartResponseSchema>;

export const meResponseSchema = userSchema;
export type MeResponse = z.infer<typeof meResponseSchema>;

export const okResponseSchema = z.object({
  ok: z.literal(true),
});
export type OkResponse = z.infer<typeof okResponseSchema>;

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export const googleCallbackQuerySchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
  state: z.string().optional(),
});
export type GoogleCallbackQuery = z.infer<typeof googleCallbackQuerySchema>;
