ALTER TABLE "meetings" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "mailbox_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox" "mailbox" NOT NULL,
	"email" text NOT NULL,
	"connected_by" uuid NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"google_sub" text,
	"gmail_history_id" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_connections_mailbox_unique" UNIQUE("mailbox")
);
--> statement-breakpoint
ALTER TABLE "mailbox_connections" ADD CONSTRAINT "mailbox_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_person_calendar_event_id_unique" ON "meetings" USING btree ("person_id","calendar_event_id");