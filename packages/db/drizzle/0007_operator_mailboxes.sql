DELETE FROM "mailbox_connections" WHERE "mailbox" = 'shared';--> statement-breakpoint
ALTER TYPE "mailbox" RENAME TO "mailbox_old";--> statement-breakpoint
CREATE TYPE "mailbox" AS ENUM('personal', 'partner');--> statement-breakpoint
ALTER TABLE "mailbox_connections" ALTER COLUMN "mailbox" TYPE "mailbox" USING (
  CASE "mailbox"::text WHEN 'shared' THEN 'partner' ELSE "mailbox"::text END
)::"mailbox";--> statement-breakpoint
ALTER TABLE "email_threads" ALTER COLUMN "mailbox" TYPE "mailbox" USING (
  CASE "mailbox"::text WHEN 'shared' THEN 'partner' ELSE "mailbox"::text END
)::"mailbox";--> statement-breakpoint
DROP TYPE "mailbox_old";
