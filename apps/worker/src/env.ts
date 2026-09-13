import { z } from "zod";
import { isCampaignFromAddress, isFeatureFlagOn, normalizeEmail } from "@realm-labs/contracts";
import { alertSinkRequiredForSend } from "./lib/alert.js";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "TOKEN_ENCRYPTION_KEY must be 64 hex characters"),
  EMAIL_HASH_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "EMAIL_HASH_KEY must be 64 hex characters"),
  RESUME_STORAGE_DIR: z.string().default("data/resumes"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  WORKER_HEALTH_PORT: z.coerce.number().default(3002),
  CAMPAIGN_TAG_WEBHOOK_URL: z.string().default(""),
  CAMPAIGN_TAG_WEBHOOK_SECRET: z.string().default(""),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  CAMPAIGN_FROM_EMAIL: z.string().default("hello@mail.realmlabs.co"),
  CAMPAIGN_FROM_NAME: z.string().default("Realm Labs"),
  POSTMARK_SERVER_TOKEN: z.string().default(""),
  POSTMARK_MESSAGE_STREAM: z.string().default("broadcast"),
  POSTMARK_SEND_ENABLED: z
    .string()
    .optional()
    .transform((value) => isFeatureFlagOn(value)),
  SEND_SEED_EMAILS: z.string().default(""),
  ALERT_WEBHOOK_URL: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  const fromEmail = normalizeEmail(parsed.CAMPAIGN_FROM_EMAIL);
  if (!isCampaignFromAddress(fromEmail)) {
    throw new Error("CAMPAIGN_FROM_EMAIL must use @mail.realmlabs.co");
  }
  if (
    alertSinkRequiredForSend({
      sendEnabled: parsed.POSTMARK_SEND_ENABLED,
      alertWebhookUrl: parsed.ALERT_WEBHOOK_URL,
    })
  ) {
    throw new Error(
      "POSTMARK_SEND_ENABLED requires ALERT_WEBHOOK_URL (Slack incoming webhook or equivalent)",
    );
  }
  return {
    ...parsed,
    CAMPAIGN_FROM_EMAIL: fromEmail,
  };
}
