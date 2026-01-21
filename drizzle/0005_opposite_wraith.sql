-- Enable pg_trgm extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exercise_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"alias" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_exercise_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"use_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exercise_aliases" ADD CONSTRAINT "exercise_aliases_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_exercise_history" ADD CONSTRAINT "user_exercise_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_exercise_history" ADD CONSTRAINT "user_exercise_history_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exercise_aliases_exercise_id_idx" ON "exercise_aliases" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exercise_aliases_alias_idx" ON "exercise_aliases" USING btree ("alias");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_exercise_history_user_exercise_idx" ON "user_exercise_history" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_exercise_history_user_last_used_idx" ON "user_exercise_history" USING btree ("user_id","last_used_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exercises_difficulty_idx" ON "exercises" USING btree ("difficulty");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exercises_movement_pattern_idx" ON "exercises" USING btree ("movement_pattern");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exercises_exercise_type_idx" ON "exercises" USING btree ("exercise_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exercises_popularity_score_idx" ON "exercises" USING btree ("popularity_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exercises_is_custom_idx" ON "exercises" USING btree ("is_custom");--> statement-breakpoint
-- Trigram indexes for fuzzy search
CREATE INDEX IF NOT EXISTS "exercises_name_trgm_idx" ON "exercises" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exercise_aliases_alias_trgm_idx" ON "exercise_aliases" USING gin ("alias" gin_trgm_ops);