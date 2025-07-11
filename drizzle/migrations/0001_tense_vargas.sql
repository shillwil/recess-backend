ALTER TABLE "users" ALTER COLUMN "name" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "firebase_uid" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "handle" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_picture_url" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "total_volume_lifted" numeric;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_workout_date" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "current_workout_streak" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "unit_preference" varchar(3);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_notification_token" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notifications_enabled" boolean;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_unique" UNIQUE("handle");