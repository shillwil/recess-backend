ALTER TABLE "ai_generation_logs" DROP CONSTRAINT "ai_generation_logs_program_id_workout_programs_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_program_id_workout_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."workout_programs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
