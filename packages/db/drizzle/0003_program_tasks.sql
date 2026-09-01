ALTER TYPE "lead_temp" ADD VALUE IF NOT EXISTS 'lukewarm';--> statement-breakpoint
CREATE TYPE "program_track" AS ENUM('allocation', 'incubator', 'recruitment', 'capital_raising');--> statement-breakpoint
CREATE TYPE "task_kind" AS ENUM('email', 'call', 'meeting', 'dnc');--> statement-breakpoint
CREATE TYPE "task_status" AS ENUM('open', 'done', 'rescheduled');--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "program_track" "program_track";--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "resume_filename" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "resume_content_type" text;--> statement-breakpoint
CREATE TYPE "budget_qualified_new" AS ENUM('light', 'heavy', 'not_qualified', 'unknown');--> statement-breakpoint
ALTER TABLE "people" ALTER COLUMN "budget_qualified" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "people" ALTER COLUMN "budget_qualified" SET DATA TYPE "budget_qualified_new" USING (
  CASE "budget_qualified"::text
    WHEN 'yes' THEN 'light'
    WHEN 'no' THEN 'not_qualified'
    ELSE 'unknown'
  END
)::"budget_qualified_new";--> statement-breakpoint
ALTER TABLE "people" ALTER COLUMN "budget_qualified" SET DEFAULT 'unknown';--> statement-breakpoint
DROP TYPE "budget_qualified";--> statement-breakpoint
ALTER TYPE "budget_qualified_new" RENAME TO "budget_qualified";--> statement-breakpoint
CREATE TYPE "incubator_stage_new" AS ENUM('sent', 'applied', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "incubator_cards" ALTER COLUMN "stage" SET DATA TYPE "incubator_stage_new" USING (
  CASE "stage"::text
    WHEN 'routed' THEN 'sent'
    WHEN 'application_sent' THEN 'sent'
    WHEN 'application_received' THEN 'applied'
    WHEN 'offer_made' THEN 'approved'
    WHEN 'paid' THEN 'approved'
    WHEN 'enrolled' THEN 'approved'
    WHEN 'closed' THEN 'rejected'
    ELSE 'sent'
  END
)::"incubator_stage_new";--> statement-breakpoint
DROP TYPE "incubator_stage";--> statement-breakpoint
ALTER TYPE "incubator_stage_new" RENAME TO "incubator_stage";--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "task_kind" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"notes" text,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
