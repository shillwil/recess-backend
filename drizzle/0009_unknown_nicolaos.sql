DO $$ BEGIN
 CREATE TYPE "public"."share_type" AS ENUM('program', 'template');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"type" "share_type" NOT NULL,
	"item_id" uuid NOT NULL,
	"shared_by" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shares" ADD CONSTRAINT "shares_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shares_token_idx" ON "shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shares_shared_by_idx" ON "shares" USING btree ("shared_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shares_type_item_idx" ON "shares" USING btree ("type","item_id");