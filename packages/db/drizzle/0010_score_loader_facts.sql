DO $$ BEGIN
  CREATE TYPE "person_email_source" AS ENUM('thread', 'manual');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "attendee_accepted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "attendee_accepted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"email" text NOT NULL,
	"source" "person_email_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "person_emails_email_unique" ON "person_emails" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_emails_person_id_idx" ON "person_emails" USING btree ("person_id");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "person_emails" ADD CONSTRAINT "person_emails_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "person_emails" ADD CONSTRAINT "person_emails_email_lowercase" CHECK ("email" = lower("email"));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
