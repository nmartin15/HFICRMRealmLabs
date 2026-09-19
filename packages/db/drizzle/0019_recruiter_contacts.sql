DO $$ BEGIN
  CREATE TYPE "contact_kind" AS ENUM('contact', 'recruiter');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "recruiter_specialty" AS ENUM('quant_analyst', 'quant_developer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "contact_kind" "contact_kind" DEFAULT 'contact' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "recruiter_specialty" "recruiter_specialty";--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "source_recruiter_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_source_recruiter_id_idx" ON "people" USING btree ("source_recruiter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_contact_kind_idx" ON "people" USING btree ("contact_kind");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "people" ADD CONSTRAINT "people_source_recruiter_id_people_id_fk" FOREIGN KEY ("source_recruiter_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "people" ADD CONSTRAINT "people_recruiter_specialty" CHECK (("people"."contact_kind" = 'contact' and "people"."recruiter_specialty" is null) or ("people"."contact_kind" = 'recruiter' and "people"."recruiter_specialty" is not null));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "people" ADD CONSTRAINT "people_source_recruiter" CHECK (("people"."source" = 'recruiter' and "people"."source_recruiter_id" is not null) or ("people"."source" <> 'recruiter' and "people"."source_recruiter_id" is null));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "people" ADD CONSTRAINT "people_recruiter_not_sourced_from_recruiter" CHECK ("people"."contact_kind" <> 'recruiter' or "people"."source" <> 'recruiter');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
