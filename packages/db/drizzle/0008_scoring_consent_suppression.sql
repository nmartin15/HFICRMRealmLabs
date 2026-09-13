DO $$ BEGIN
  CREATE TYPE "suppression_reason" AS ENUM('unsubscribed', 'complained', 'hard_bounced', 'do_not_contact', 'rejected', 'enrolled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "consent_channel" AS ENUM('inquiry', 'newsletter', 'stay_in_touch');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "consent_status" AS ENUM('granted', 'withdrawn');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "consent_source" AS ENUM('website_form', 'operator', 'import', 'email_link');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "person_signal_kind" AS ENUM('aum_or_budget', 'warmth', 'decision_timeline', 'program_fit', 'objection', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "person_signal_source" AS ENUM('email_message', 'task', 'meeting', 'activity_note', 'website_lead', 'import', 'operator');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "score" integer;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_score_range" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100));--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_email_hash_unique" ON "email_suppressions" USING btree ("email_hash");--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "email_suppression_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suppression_id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "email_suppression_events" ADD CONSTRAINT "email_suppression_events_suppression_id_email_suppressions_id_fk" FOREIGN KEY ("suppression_id") REFERENCES "public"."email_suppressions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppression_events" ADD CONSTRAINT "email_suppression_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "person_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" "consent_channel" NOT NULL,
	"status" "consent_status" NOT NULL,
	"source" "consent_source" NOT NULL,
	"granted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "person_consents_person_id_channel_unique" ON "person_consents" USING btree ("person_id","channel");--> statement-breakpoint
ALTER TABLE "person_consents" ADD CONSTRAINT "person_consents_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "person_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"email_hash" text NOT NULL,
	"channel" "consent_channel" NOT NULL,
	"status" "consent_status" NOT NULL,
	"source" "consent_source" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "person_consent_events" ADD CONSTRAINT "person_consent_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "person_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "person_signal_kind" NOT NULL,
	"value" jsonb NOT NULL,
	"excerpt" text,
	"source_type" "person_signal_source" NOT NULL,
	"source_email_message_id" uuid,
	"source_task_id" uuid,
	"source_meeting_id" uuid,
	"source_activity_id" uuid,
	"extractor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_signals_source_fk" CHECK ((
		("source_type" IN ('operator', 'import', 'website_lead')
			AND "source_email_message_id" IS NULL
			AND "source_task_id" IS NULL
			AND "source_meeting_id" IS NULL
			AND "source_activity_id" IS NULL)
		OR ("source_type" = 'email_message'
			AND "source_email_message_id" IS NOT NULL
			AND "source_task_id" IS NULL
			AND "source_meeting_id" IS NULL
			AND "source_activity_id" IS NULL)
		OR ("source_type" = 'task'
			AND "source_email_message_id" IS NULL
			AND "source_task_id" IS NOT NULL
			AND "source_meeting_id" IS NULL
			AND "source_activity_id" IS NULL)
		OR ("source_type" = 'meeting'
			AND "source_email_message_id" IS NULL
			AND "source_task_id" IS NULL
			AND "source_meeting_id" IS NOT NULL
			AND "source_activity_id" IS NULL)
		OR ("source_type" = 'activity_note'
			AND "source_email_message_id" IS NULL
			AND "source_task_id" IS NULL
			AND "source_meeting_id" IS NULL
			AND "source_activity_id" IS NOT NULL)
	))
);--> statement-breakpoint
ALTER TABLE "person_signals" ADD CONSTRAINT "person_signals_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_signals" ADD CONSTRAINT "person_signals_source_email_message_id_email_messages_id_fk" FOREIGN KEY ("source_email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_signals" ADD CONSTRAINT "person_signals_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_signals" ADD CONSTRAINT "person_signals_source_meeting_id_meetings_id_fk" FOREIGN KEY ("source_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_signals" ADD CONSTRAINT "person_signals_source_activity_id_activities_id_fk" FOREIGN KEY ("source_activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "person_score_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"formula_version" text NOT NULL,
	"score" integer NOT NULL,
	"bucket" "lead_temp" NOT NULL,
	"inputs" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"computed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_score_snapshots_score_range" CHECK ("score" >= 0 AND "score" <= 100)
);--> statement-breakpoint
ALTER TABLE "person_score_snapshots" ADD CONSTRAINT "person_score_snapshots_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_score_snapshots" ADD CONSTRAINT "person_score_snapshots_computed_by_users_id_fk" FOREIGN KEY ("computed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
