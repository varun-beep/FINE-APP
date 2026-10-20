CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lever_id" text NOT NULL,
	"category" text NOT NULL,
	"metric" text NOT NULL,
	"target" text NOT NULL,
	"baseline" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "period_type" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_pkey";--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_period_type_review_date_pk" PRIMARY KEY("period_type","review_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experiments_status_idx" ON "experiments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experiments_category_status_idx" ON "experiments" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_period_date_idx" ON "reviews" USING btree ("period_type","review_date");