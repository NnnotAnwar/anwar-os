CREATE TABLE "ops_files_check" (
	"owner_id" text PRIMARY KEY DEFAULT app.current_user_id() NOT NULL,
	"status" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"findings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_files_check_status_valid" CHECK ("ops_files_check"."status" in ('ok', 'problems', 'error')),
	CONSTRAINT "ops_files_check_error_length" CHECK (char_length("ops_files_check"."error") <= 1000),
	CONSTRAINT "ops_files_check_findings_size" CHECK (octet_length("ops_files_check"."findings"::text) <= 262144)
);
--> statement-breakpoint
ALTER TABLE "ops_alert_settings" DROP CONSTRAINT "ops_alert_settings_kinds_valid";--> statement-breakpoint
ALTER TABLE "ops_alert_state" DROP CONSTRAINT "ops_alert_state_kind_valid";--> statement-breakpoint
ALTER TABLE "ops_files_check" ADD CONSTRAINT "ops_files_check_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_alert_settings" ADD CONSTRAINT "ops_alert_settings_kinds_valid" CHECK ("ops_alert_settings"."disabled_kinds" <@ array['disk', 'memory', 'backup', 'cert', 'container', 'reboot', 'agent', 'files']::text[]);--> statement-breakpoint
ALTER TABLE "ops_alert_state" ADD CONSTRAINT "ops_alert_state_kind_valid" CHECK ("ops_alert_state"."kind" in ('disk', 'memory', 'backup', 'cert', 'container', 'reboot', 'agent', 'files'));