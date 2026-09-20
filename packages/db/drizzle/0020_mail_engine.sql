DO $$ BEGIN
  CREATE TYPE "mail_enrollment_status" AS ENUM('scheduled', 'queued', 'canceled', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "outbound_sends" ADD COLUMN IF NOT EXISTS "reply_to" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "outbound_sends" ADD CONSTRAINT "outbound_sends_reply_to_lowercase" CHECK ("reply_to" is null or "reply_to" = lower("reply_to"));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lane" "campaign_lane" NOT NULL,
	"program" text NOT NULL,
	"stage" text NOT NULL,
	"purpose" "outbound_send_purpose" NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mail_templates_lane_program_stage_unique" ON "mail_templates" USING btree ("lane","program","stage");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_mail_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"touch_index" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "mail_enrollment_status" DEFAULT 'scheduled' NOT NULL,
	"outbound_send_id" uuid,
	"enrolled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "person_mail_enrollments" ADD CONSTRAINT "person_mail_enrollments_touch_index" CHECK ("touch_index" in (0, 1));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "person_mail_enrollments_enrollment_touch_unique" ON "person_mail_enrollments" USING btree ("enrollment_id","touch_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_mail_enrollments_person_status_idx" ON "person_mail_enrollments" USING btree ("person_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_mail_enrollments_due_status_idx" ON "person_mail_enrollments" USING btree ("status","due_at");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "person_mail_enrollments" ADD CONSTRAINT "person_mail_enrollments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "person_mail_enrollments" ADD CONSTRAINT "person_mail_enrollments_outbound_send_id_outbound_sends_id_fk" FOREIGN KEY ("outbound_send_id") REFERENCES "public"."outbound_sends"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
