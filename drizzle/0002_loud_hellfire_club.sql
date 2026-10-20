CREATE TABLE "day_closures" (
	"day" date PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"frequency" text NOT NULL,
	"anchor_date" date NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"last_posted_through" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "kind" text DEFAULT 'spend' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "one_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_price_history" ADD CONSTRAINT "schedule_price_history_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_history_schedule_effective_idx" ON "schedule_price_history" USING btree ("schedule_id","effective_from");--> statement-breakpoint
CREATE INDEX "schedules_active_idx" ON "schedules" USING btree ("active");--> statement-breakpoint
CREATE INDEX "schedules_kind_idx" ON "schedules" USING btree ("kind");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_schedule_spent_on_idx" ON "expenses" USING btree ("schedule_id","spent_on") WHERE schedule_id IS NOT NULL;