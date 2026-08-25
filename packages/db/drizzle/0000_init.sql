CREATE TYPE "public"."activity_type" AS ENUM('note', 'stage_change', 'decision', 'meeting', 'email', 'field_change', 'import', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."allocation_decision" AS ENUM('allocate', 'route_incubator', 'pass');--> statement-breakpoint
CREATE TYPE "public"."allocation_stage" AS ENUM('applied', 'contacted', 'in_conversation', 'decision', 'allocated', 'nurture', 'passed');--> statement-breakpoint
CREATE TYPE "public"."budget_qualified" AS ENUM('yes', 'no', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."incubator_stage" AS ENUM('routed', 'application_sent', 'application_received', 'offer_made', 'paid', 'enrolled', 'closed');--> statement-breakpoint
CREATE TYPE "public"."incubator_tier" AS ENUM('tier_1', 'tier_2', 'tier_3', 'tier_4');--> statement-breakpoint
CREATE TYPE "public"."lead_temp" AS ENUM('hot', 'warm', 'cold');--> statement-breakpoint
CREATE TYPE "public"."mailbox" AS ENUM('personal', 'shared');--> statement-breakpoint
CREATE TYPE "public"."meeting_outcome" AS ENUM('scheduled', 'held', 'no_show', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."person_source" AS ENUM('linkedin', 'workable', 'referral', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "activity_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocation_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"stage" "allocation_stage" NOT NULL,
	"decision" "allocation_decision",
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"pass_reason" text,
	"nurture_follow_up_at" date,
	"no_call_app_link" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_cards_person_id_unique" UNIQUE("person_id")
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"mailbox" "mailbox" NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"subject" text NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"snippet" text,
	"participant_emails" text[] NOT NULL,
	"shared_visible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incubator_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"stage" "incubator_stage" NOT NULL,
	"tier" "incubator_tier",
	"price_usd" integer,
	"application_ref" text,
	"application_result" text,
	"routing_detail" text,
	"routed_at" timestamp with time zone NOT NULL,
	"close_reason" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incubator_cards_person_id_unique" UNIQUE("person_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"calendar_event_id" text,
	"outcome" "meeting_outcome" DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"title" text,
	"company" text,
	"location" text,
	"source" "person_source" NOT NULL,
	"resume_url" text,
	"applied_at" date,
	"notes" text,
	"lead_temp" "lead_temp",
	"budget_qualified" "budget_qualified" DEFAULT 'unknown' NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "people_email_lowercase" CHECK ("people"."email" = lower("people"."email"))
);
--> statement-breakpoint
CREATE TABLE "report_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"linkedin_impressions" integer NOT NULL,
	"job_post_applies" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"google_sub" text,
	"role" "user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cards" ADD CONSTRAINT "allocation_cards_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cards" ADD CONSTRAINT "allocation_cards_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incubator_cards" ADD CONSTRAINT "incubator_cards_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_inputs" ADD CONSTRAINT "report_inputs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_threads_mailbox_gmail_thread_id_unique" ON "email_threads" USING btree ("mailbox","gmail_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_unique" ON "people" USING btree ("email");