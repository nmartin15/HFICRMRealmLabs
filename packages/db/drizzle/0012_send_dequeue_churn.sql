ALTER TYPE "outbound_send_status" ADD VALUE IF NOT EXISTS 'blocked';--> statement-breakpoint
ALTER TYPE "outbound_send_status" ADD VALUE IF NOT EXISTS 'sent';--> statement-breakpoint
ALTER TABLE "person_campaign_tags" ADD COLUMN IF NOT EXISTS "program_stage_start_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "person_campaign_tags" ADD COLUMN IF NOT EXISTS "program_stage_start_window_at" timestamp with time zone;--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbound_sends_reject_suppressed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  suppressed_reason text;
BEGIN
  IF NEW.status <> 'queued' THEN
    RETURN NEW;
  END IF;
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
