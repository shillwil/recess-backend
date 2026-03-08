CREATE TABLE IF NOT EXISTS "ai_generation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"inspiration_source" text,
	"days_per_week" integer NOT NULL,
	"session_duration_minutes" integer,
	"experience_level" varchar(20),
	"goal" varchar(50),
	"equipment" jsonb,
	"used_training_history" boolean DEFAULT false,
	"free_text_preferences" text,
	"program_id" uuid,
	"success" boolean NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"generation_time_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"user_rating" integer,
	"user_feedback" text,
	"personalization_source" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_strength_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strength_entries" jsonb DEFAULT '[]'::jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_generations_this_month" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_generations_reset_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_tier" varchar(20) DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "ai_model" varchar(50);--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "ai_generation_time_ms" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_program_id_workout_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."workout_programs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_strength_profiles" ADD CONSTRAINT "user_strength_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_gen_logs_user_id_idx" ON "ai_generation_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_gen_logs_created_at_idx" ON "ai_generation_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_strength_profiles_user_id_idx" ON "user_strength_profiles" USING btree ("user_id");