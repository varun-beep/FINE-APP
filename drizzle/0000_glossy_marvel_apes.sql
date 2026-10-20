CREATE TABLE "budgets" (
	"category" text PRIMARY KEY NOT NULL,
	"monthly_limit_paise" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount_paise" integer NOT NULL,
	"category" text NOT NULL,
	"note" text,
	"merchant" text,
	"spent_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"review_date" date PRIMARY KEY NOT NULL,
	"stats_json" jsonb NOT NULL,
	"advice_json" jsonb,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "expenses_spent_on_idx" ON "expenses" USING btree ("spent_on");--> statement-breakpoint
CREATE INDEX "expenses_category_spent_on_idx" ON "expenses" USING btree ("category","spent_on");