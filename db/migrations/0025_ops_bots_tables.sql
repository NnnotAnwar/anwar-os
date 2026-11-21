CREATE TABLE "ops_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"actor" text DEFAULT '' NOT NULL,
	"service" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_events_action_valid" CHECK ("ops_events"."action" in ('start', 'stop', 'restart', 'deploy')),
	CONSTRAINT "ops_events_result_valid" CHECK ("ops_events"."result" in ('pending', 'ok', 'error', 'refused')),
	CONSTRAINT "ops_events_service_format" CHECK ("ops_events"."service" ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'),
	CONSTRAINT "ops_events_actor_length" CHECK (char_length("ops_events"."actor") <= 200),
	CONSTRAINT "ops_events_error_length" CHECK (char_length("ops_events"."error") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "bots_bots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"telegram_username" text,
	"service_name" text,
	"stats_source" text,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bots_bots_name_length" CHECK (char_length("bots_bots"."name") between 1 and 60),
	CONSTRAINT "bots_bots_username_format" CHECK ("bots_bots"."telegram_username" ~ '^[A-Za-z][A-Za-z0-9_]{3,31}$'),
	CONSTRAINT "bots_bots_service_format" CHECK ("bots_bots"."service_name" ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'),
	CONSTRAINT "bots_bots_stats_source_format" CHECK ("bots_bots"."stats_source" ~ '^(osbot|bot_[a-z0-9_]{1,40})$'),
	CONSTRAINT "bots_bots_description_length" CHECK (char_length("bots_bots"."description") <= 300)
);
--> statement-breakpoint
ALTER TABLE "projects_projects" ADD COLUMN "service_name" text;--> statement-breakpoint
ALTER TABLE "ops_events" ADD CONSTRAINT "ops_events_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bots_bots" ADD CONSTRAINT "bots_bots_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ops_events_owner_created_idx" ON "ops_events" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ops_events_owner_service_idx" ON "ops_events" USING btree ("owner_id","service","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "bots_bots_owner_name_key" ON "bots_bots" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "bots_bots_owner_order_idx" ON "bots_bots" USING btree ("owner_id","sort_order","created_at");--> statement-breakpoint
ALTER TABLE "projects_projects" ADD CONSTRAINT "projects_projects_service_format" CHECK ("projects_projects"."service_name" ~ '^[a-z0-9][a-z0-9_.-]{0,62}$');