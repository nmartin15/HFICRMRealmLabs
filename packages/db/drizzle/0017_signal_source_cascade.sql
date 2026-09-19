ALTER TABLE "person_signals" DROP CONSTRAINT "person_signals_source_email_message_id_email_messages_id_fk";--> statement-breakpoint
ALTER TABLE "person_signals" DROP CONSTRAINT "person_signals_source_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "person_signals" DROP CONSTRAINT "person_signals_source_meeting_id_meetings_id_fk";--> statement-breakpoint
ALTER TABLE "person_signals" DROP CONSTRAINT "person_signals_source_activity_id_activities_id_fk";--> statement-breakpoint
ALTER TABLE "person_signals" ADD CONSTRAINT "person_signals_source_email_message_id_email_messages_id_fk" FOREIGN KEY ("source_email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_signals" ADD CONSTRAINT "person_signals_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_signals" ADD CONSTRAINT "person_signals_source_meeting_id_meetings_id_fk" FOREIGN KEY ("source_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_signals" ADD CONSTRAINT "person_signals_source_activity_id_activities_id_fk" FOREIGN KEY ("source_activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;
