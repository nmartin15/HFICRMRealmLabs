CREATE TABLE IF NOT EXISTS "email_hash_key_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_hash_key_state_fingerprint_unique" ON "email_hash_key_state" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_hash_key_state_singleton" ON "email_hash_key_state" ((true));--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbound_sends_reject_suppressed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  suppressed_reason text;
BEGIN
  IF NEW.status NOT IN ('queued', 'sent') THEN
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
        DETAIL = 'suppressed addresses cannot be queued or marked sent';
  END IF;
  IF NEW.purpose = 'sales' AND suppressed_reason IN ('rejected', 'enrolled') THEN
    RAISE EXCEPTION 'SUPPRESSED'
      USING ERRCODE = '23514',
        DETAIL = 'rejected or enrolled addresses cannot be queued or marked sent for sales';
  END IF;
  RETURN NEW;
END;
$$;
