DO $$ BEGIN
 CREATE TYPE "public"."difficulty_level" AS ENUM('beginner', 'intermediate', 'advanced');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."exercise_type" AS ENUM('compound', 'isolation', 'cardio', 'plyometric', 'stretch');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."movement_pattern" AS ENUM('push', 'pull', 'hinge', 'squat', 'lunge', 'carry', 'rotation', 'core');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "exercises" RENAME COLUMN "muscle_groups" TO "primary_muscles";--> statement-breakpoint
ALTER TABLE "workout_exercises" RENAME COLUMN "muscle_groups" TO "primary_muscles";--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "secondary_muscles" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "difficulty" "difficulty_level";--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "movement_pattern" "movement_pattern";--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "exercise_type" "exercise_type";--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "total_times_used" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "last_used_at" timestamp;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "popularity_score" numeric(10, 2) DEFAULT '0';