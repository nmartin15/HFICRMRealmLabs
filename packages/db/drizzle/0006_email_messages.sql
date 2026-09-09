CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"from_email" text NOT NULL,
	"to_emails" text[] NOT NULL,
	"cc_emails" text[] NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"body_text" text NOT NULL,
	"snippet" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_thread_gmail_message_id_unique" ON "email_messages" USING btree ("thread_id","gmail_message_id");--> statement-breakpoint
UPDATE "mailbox_connections" SET "gmail_history_id" = NULL;
