CREATE TABLE "budget_bot_heartbeats" (
	"owner_id" text PRIMARY KEY DEFAULT app.current_user_id() NOT NULL,
	"version" text DEFAULT 'dev' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_beat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_bot_heartbeats_version_length" CHECK (char_length("budget_bot_heartbeats"."version") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "bots_bots" DROP CONSTRAINT "bots_bots_stats_source_format";--> statement-breakpoint
ALTER TABLE "budget_transactions" ADD COLUMN "import_key" text;--> statement-breakpoint
ALTER TABLE "budget_bot_heartbeats" ADD CONSTRAINT "budget_bot_heartbeats_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_transactions" ADD CONSTRAINT "budget_transactions_owner_import_key" UNIQUE("owner_id","import_key");--> statement-breakpoint
ALTER TABLE "budget_transactions" ADD CONSTRAINT "budget_transactions_import_key_length" CHECK (char_length("budget_transactions"."import_key") between 1 and 200);--> statement-breakpoint
ALTER TABLE "bots_bots" ADD CONSTRAINT "bots_bots_stats_source_format" CHECK ("bots_bots"."stats_source" ~ '^(osbot|budget-bot|bot_[a-z0-9_]{1,40})$');