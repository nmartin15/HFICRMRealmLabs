DO $$ BEGIN
  CREATE TYPE "campaign_lane" AS ENUM('sales', 'newsletter');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "campaign_intensity" AS ENUM('none', 'soft', 'cold', 'lukewarm', 'warm', 'hot');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "campaign_sequence_action" AS ENUM('start', 'stop', 'hold', 'pending_review');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "outbound_send_purpose" AS ENUM('sales', 'newsletter', 'value_add');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "outbound_send_status" AS ENUM('queued');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_campaign_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"tag" text,
	"previous_tag" text,
	"lane" "campaign_lane",
	"program" text,
	"stage" text,
	"intensity" "campaign_intensity",
	"sequence_id" text,
	"sequence_action" "campaign_sequence_action",
	"bucket" "lead_temp",
	"program_stage_key" text,
	"last_sequence_start_at" timestamp with time zone,
	"last_start_program_stage_key" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "person_campaign_tags_person_id_unique" ON "person_campaign_tags" USING btree ("person_id");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "person_campaign_tags" ADD CONSTRAINT "person_campaign_tags_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"email_hash" text NOT NULL,
	"to_email" text NOT NULL,
	"purpose" "outbound_send_purpose" NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"tag" text,
	"status" "outbound_send_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "outbound_sends" ADD CONSTRAINT "outbound_sends_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "outbound_sends" ADD CONSTRAINT "outbound_sends_email_lowercase" CHECK ("to_email" = lower("to_email"));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbound_sends_reject_suppressed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  suppressed_reason text;
BEGIN
  SELECT reason::text INTO suppressed_reason
  FROM email_suppressions
  WHERE email_hash = NEW.email_hash
  LIMIT 1;
  IF suppressed_reason IS NULL THEN
    RETURN NEW;
  END IF;
  IF suppressed_reason IN ('unsubscribed', 'complained', 'do_not_contact', 'hard_bounced') THEN
    RAISE EXCEPTION 'SUPPRESSED'
      USING ERRCODE = '23514',
        DETAIL = 'suppressed addresses cannot be queued for send';
  END IF;
  IF NEW.purpose = 'sales' AND suppressed_reason IN ('rejected', 'enrolled') THEN
    RAISE EXCEPTION 'SUPPRESSED'
      USING ERRCODE = '23514',
        DETAIL = 'rejected or enrolled addresses cannot be queued for sales sends';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS outbound_sends_reject_suppressed_trigger ON outbound_sends;--> statement-breakpoint
CREATE TRIGGER outbound_sends_reject_suppressed_trigger
BEFORE INSERT OR UPDATE ON outbound_sends
FOR EACH ROW
EXECUTE PROCEDURE outbound_sends_reject_suppressed();
