CREATE TABLE "insight_log" (
	"insight_key" text PRIMARY KEY NOT NULL,
	"first_shown" timestamp with time zone DEFAULT now() NOT NULL,
	"last_shown" timestamp with time zone DEFAULT now() NOT NULL,
	"times_shown" integer DEFAULT 1 NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"feedback" text,
	"last_impact_paise" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "insight_log_last_shown_idx" ON "insight_log" USING btree ("last_shown");--> statement-breakpoint
CREATE INDEX "insight_log_dismissed_idx" ON "insight_log" USING btree ("dismissed");