CREATE TABLE "ops_alert_settings" (
	"owner_id" text PRIMARY KEY DEFAULT app.current_user_id() NOT NULL,
	"disabled_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"muted_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_alert_settings_kinds_valid" CHECK ("ops_alert_settings"."disabled_kinds" <@ array['disk', 'memory', 'backup', 'cert', 'container', 'reboot', 'agent']::text[])
);
--> statement-breakpoint
CREATE TABLE "ops_alert_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"firing" boolean DEFAULT true NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_firing" boolean DEFAULT false NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_alert_state_owner_key" UNIQUE("owner_id","key"),
	CONSTRAINT "ops_alert_state_key_format" CHECK ("ops_alert_state"."key" ~ '^[a-z][a-z0-9_.:-]{0,199}$'),
	CONSTRAINT "ops_alert_state_kind_valid" CHECK ("ops_alert_state"."kind" in ('disk', 'memory', 'backup', 'cert', 'container', 'reboot', 'agent')),
	CONSTRAINT "ops_alert_state_title_length" CHECK (char_length("ops_alert_state"."title") between 1 and 200),
	CONSTRAINT "ops_alert_state_detail_length" CHECK (char_length("ops_alert_state"."detail") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "ops_alert_settings" ADD CONSTRAINT "ops_alert_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_alert_state" ADD CONSTRAINT "ops_alert_state_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;