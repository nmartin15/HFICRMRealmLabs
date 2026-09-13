import { z } from "zod";
import {
  emailSchema,
  isCampaignFromAddress,
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
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "TOKEN_ENCRYPTION_KEY must be 64 hex characters"),
  EMAIL_HASH_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "EMAIL_HASH_KEY must be 64 hex characters"),
  RESUME_STORAGE_DIR: z.string().default("data/resumes"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z
    .string()
    .default("http://localhost:3000/api/auth/google/callback"),
  APPLICATION_WEBHOOK_SECRET: z.string().default(""),
  WEBSITE_INTAKE_SECRET: z.string().default(""),
  WEBSITE_ORIGIN: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_ENABLED: z
    .string()
    .optional()
    .transform((value) => isFeatureFlagOn(value)),
  CAMPAIGN_SYNC_SECRET: z.string().default(""),
  CAMPAIGN_TAG_WEBHOOK_URL: z.string().default(""),
  CAMPAIGN_TAG_WEBHOOK_SECRET: z.string().default(""),
  CAMPAIGN_FROM_EMAIL: z.string().default("hello@mail.realmlabs.co"),
  CAMPAIGN_FROM_NAME: z.string().default("Realm Labs"),
  POSTMARK_SERVER_TOKEN: z.string().default(""),
  POSTMARK_MESSAGE_STREAM: z.string().default("broadcast"),
  POSTMARK_WEBHOOK_USER: z.string().default(""),
  POSTMARK_WEBHOOK_PASSWORD: z.string().default(""),
  POSTMARK_SEND_ENABLED: z
    .string()
    .optional()
    .transform((value) => isFeatureFlagOn(value)),
  KICKBOX_API_KEY: z.string().default(""),
  SEND_SEED_EMAILS: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  const fromEmail = normalizeEmail(parsed.CAMPAIGN_FROM_EMAIL);
  if (!isCampaignFromAddress(fromEmail)) {
    throw new Error("CAMPAIGN_FROM_EMAIL must use @mail.realmlabs.co");
  }
  return {
    ...parsed,
    ADMIN_EMAIL: normalizeEmail(parsed.ADMIN_EMAIL),
    ALLOWED_HOSTED_DOMAIN: parsed.ALLOWED_HOSTED_DOMAIN.trim().toLowerCase(),
    CAMPAIGN_FROM_EMAIL: fromEmail,
  };
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function campaignFromConfigured(env: Env): boolean {
  return isCampaignFromAddress(env.CAMPAIGN_FROM_EMAIL);
}
