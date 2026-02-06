ALTER TABLE "program_weeks" ALTER COLUMN "week_number" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "workout_programs" ALTER COLUMN "duration_weeks" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "program_weeks" ADD COLUMN "day_label" varchar(50);--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "days_per_week" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "is_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "current_day_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "times_completed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_weeks_program_id_idx" ON "program_weeks" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workout_programs_user_active_idx" ON "workout_programs" USING btree ("user_id","is_active");