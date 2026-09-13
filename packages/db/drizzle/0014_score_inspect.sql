ALTER TABLE "person_signals" ADD COLUMN IF NOT EXISTS "invalidated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person_signals" ADD COLUMN IF NOT EXISTS "invalidated_by" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "person_signals" ADD CONSTRAINT "person_signals_invalidated_by_users_id_fk" FOREIGN KEY ("invalidated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "score_formula_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "score_formula_configs_version_unique" ON "score_formula_configs" USING btree ("version");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "score_formula_configs" ADD CONSTRAINT "score_formula_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
