ALTER TABLE "person_score_snapshots" ADD COLUMN IF NOT EXISTS "raw_bucket" "lead_temp";--> statement-breakpoint
UPDATE "person_score_snapshots" SET "raw_bucket" = "bucket" WHERE "raw_bucket" IS NULL;--> statement-breakpoint
ALTER TABLE "person_score_snapshots" ALTER COLUMN "raw_bucket" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "person_score_snapshots" ADD COLUMN IF NOT EXISTS "hold" jsonb;--> statement-breakpoint
ALTER TABLE "person_score_snapshots" ADD COLUMN IF NOT EXISTS "as_of" timestamp with time zone;--> statement-breakpoint
UPDATE "person_score_snapshots" SET "as_of" = "computed_at" WHERE "as_of" IS NULL;--> statement-breakpoint
ALTER TABLE "person_score_snapshots" ALTER COLUMN "as_of" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "person_score_snapshots" ADD COLUMN IF NOT EXISTS "trigger" text;--> statement-breakpoint
UPDATE "person_score_snapshots" SET "trigger" = 'manual_edit' WHERE "trigger" IS NULL;--> statement-breakpoint
ALTER TABLE "person_score_snapshots" ALTER COLUMN "trigger" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "person_score_snapshots" ADD COLUMN IF NOT EXISTS "components" jsonb;--> statement-breakpoint
UPDATE "person_score_snapshots" SET "components" = '[]'::jsonb WHERE "components" IS NULL;--> statement-breakpoint
ALTER TABLE "person_score_snapshots" ALTER COLUMN "components" SET NOT NULL;
