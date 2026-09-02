import { z } from "zod";
import {
  emailSchema,
  isFeatureFlagOn,
  normalizeEmail,
} from "@realm-labs/contracts";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  SESSION_SECRET: z.string().min(32),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  API_PORT: z.coerce.number().default(3001),
  ADMIN_EMAIL: emailSchema,
  ALLOWED_HOSTED_DOMAIN: z.string().min(1).default("realmlabs.co"),
  TOKEN_ENCRYPTION_KEY: z.string().min(64),
  RESUME_STORAGE_DIR: z.string().default("data/resumes"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z
    .string()
    .default("http://localhost:3000/api/auth/google/callback"),
  GOOGLE_MAILBOX_REDIRECT_URI: z
    .string()
    .default("http://localhost:3000/api/mailboxes/google/callback"),
  APPLICATION_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_ENABLED: z
    .string()
    .optional()
    .transform((value) => isFeatureFlagOn(value)),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  return {
    ...parsed,
    ADMIN_EMAIL: normalizeEmail(parsed.ADMIN_EMAIL),
    ALLOWED_HOSTED_DOMAIN: parsed.ALLOWED_HOSTED_DOMAIN.trim().toLowerCase(),
  };
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
