ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "email_verification_result" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_sends" ADD COLUMN IF NOT EXISTS "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "outbound_sends" ADD COLUMN IF NOT EXISTS "unsubscribe_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_sends" ADD COLUMN IF NOT EXISTS "is_seed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_sends" ADD COLUMN IF NOT EXISTS "sent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_sends_unsubscribe_token_unique" ON "outbound_sends" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"person_id" uuid,
	"outbound_send_id" uuid,
	"record_type" text NOT NULL,
	"bounce_type" text,
	"provider_message_id" text,
	"provider_trace_id" text,
	"is_seed" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_delivery_events_trace_unique" ON "email_delivery_events" USING btree ("provider_trace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_events_message_id_idx" ON "email_delivery_events" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_delivery_events_email_hash_idx" ON "email_delivery_events" USING btree ("email_hash");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_outbound_send_id_outbound_sends_id_fk" FOREIGN KEY ("outbound_send_id") REFERENCES "public"."outbound_sends"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
