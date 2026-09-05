ALTER TYPE "person_source" ADD VALUE IF NOT EXISTS 'website';--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "program_interest" AS ENUM('hedge_fund_incubator', 'lp_raising_program', 'quant_analyst_placement', 'not_sure');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "program_interest" "program_interest";
