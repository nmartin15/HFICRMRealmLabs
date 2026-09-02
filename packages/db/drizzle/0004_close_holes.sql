ALTER TABLE "people" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "calendar_event_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "outcome" "meeting_outcome";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_person_calendar_event_id_unique" ON "tasks" USING btree ("person_id","calendar_event_id");--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "person_id" DROP NOT NULL;--> statement-breakpoint
INSERT INTO "tasks" (
  "id",
  "person_id",
  "kind",
  "due_at",
  "notes",
  "status",
  "calendar_event_id",
  "outcome",
  "needs_review",
  "created_by",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  "person_id",
  'meeting',
  "scheduled_at",
  "notes",
  CASE "outcome"
    WHEN 'scheduled' THEN 'open'::"task_status"
    WHEN 'rescheduled' THEN 'rescheduled'::"task_status"
    ELSE 'done'::"task_status"
  END,
  "calendar_event_id",
  "outcome",
  "needs_review",
  "created_by",
  "created_at",
  "updated_at"
FROM "meetings";
