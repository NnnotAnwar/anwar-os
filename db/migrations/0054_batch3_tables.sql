CREATE TABLE "budget_fx_days" (
	"day" date PRIMARY KEY NOT NULL,
	"fixing_date" date NOT NULL,
	"final" boolean NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_fx_days_fixing_before_day" CHECK ("budget_fx_days"."fixing_date" <= "budget_fx_days"."day")
);
--> statement-breakpoint
CREATE TABLE "budget_fx_rates" (
	"source" text NOT NULL,
	"valid_on" date NOT NULL,
	"currency" char(3) NOT NULL,
	"units" integer NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_fx_rates_pkey" PRIMARY KEY("source","valid_on","currency"),
	CONSTRAINT "budget_fx_rates_source_valid" CHECK ("budget_fx_rates"."source" in ('daily', 'monthly')),
	CONSTRAINT "budget_fx_rates_currency_shape" CHECK ("budget_fx_rates"."currency" ~ '^[A-Z]{3}$' and "budget_fx_rates"."currency" <> 'CZK'),
	CONSTRAINT "budget_fx_rates_units_valid" CHECK ("budget_fx_rates"."units" in (1, 10, 100, 1000, 10000, 100000, 1000000)),
	CONSTRAINT "budget_fx_rates_rate_positive" CHECK ("budget_fx_rates"."rate" > 0),
	CONSTRAINT "budget_fx_rates_monthly_first" CHECK ("budget_fx_rates"."source" = 'daily' or extract(day from "budget_fx_rates"."valid_on") = 1)
);
--> statement-breakpoint
CREATE TABLE "osbot_settings" (
	"owner_id" text PRIMARY KEY DEFAULT app.current_user_id() NOT NULL,
	"brief_enabled" boolean DEFAULT true NOT NULL,
	"brief_time" time DEFAULT '08:00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_error_rate" (
	"minute" timestamp with time zone PRIMARY KEY NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"fingerprint" text NOT NULL,
	"source" text NOT NULL,
	"name" text DEFAULT 'Error' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"route" text DEFAULT '' NOT NULL,
	"method" text DEFAULT '' NOT NULL,
	"route_type" text DEFAULT '' NOT NULL,
	"render_source" text DEFAULT '' NOT NULL,
	"digest" text DEFAULT '' NOT NULL,
	"stack" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"hourly" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"hourly_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"reopened_count" integer DEFAULT 0 NOT NULL,
	"alert_pending" boolean DEFAULT true NOT NULL,
	"alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_errors_owner_fingerprint" UNIQUE("owner_id","fingerprint"),
	CONSTRAINT "ops_errors_fingerprint_format" CHECK ("ops_errors"."fingerprint" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "ops_errors_source_valid" CHECK ("ops_errors"."source" in ('web', 'osbot', 'expense-bot')),
	CONSTRAINT "ops_errors_status_valid" CHECK ("ops_errors"."status" in ('open', 'resolved')),
	CONSTRAINT "ops_errors_route_type_valid" CHECK ("ops_errors"."route_type" in ('render', 'route', 'action', 'proxy', 'process', 'bot', '')),
	CONSTRAINT "ops_errors_name_length" CHECK (char_length("ops_errors"."name") between 1 and 120),
	CONSTRAINT "ops_errors_message_length" CHECK (char_length("ops_errors"."message") <= 1000),
	CONSTRAINT "ops_errors_route_length" CHECK (char_length("ops_errors"."route") <= 300),
	CONSTRAINT "ops_errors_method_length" CHECK (char_length("ops_errors"."method") <= 10),
	CONSTRAINT "ops_errors_render_source_length" CHECK (char_length("ops_errors"."render_source") <= 60),
	CONSTRAINT "ops_errors_digest_length" CHECK (char_length("ops_errors"."digest") <= 100),
	CONSTRAINT "ops_errors_stack_length" CHECK (char_length("ops_errors"."stack") <= 6000),
	CONSTRAINT "ops_errors_hourly_length" CHECK (cardinality("ops_errors"."hourly") <= 24),
	CONSTRAINT "ops_errors_count_positive" CHECK ("ops_errors"."count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ops_restore_drills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"backup_file" text DEFAULT '' NOT NULL,
	"backup_at" timestamp with time zone,
	"backup_bytes" bigint,
	"total_rows" bigint,
	"tables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"run_url" text,
	"commit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_restore_drills_status_valid" CHECK ("ops_restore_drills"."status" in ('ok', 'failed')),
	CONSTRAINT "ops_restore_drills_backup_file_length" CHECK (char_length("ops_restore_drills"."backup_file") <= 200),
	CONSTRAINT "ops_restore_drills_error_length" CHECK (char_length("ops_restore_drills"."error") <= 2000),
	CONSTRAINT "ops_restore_drills_run_url_format" CHECK ("ops_restore_drills"."run_url" is null or (char_length("ops_restore_drills"."run_url") <= 300 and "ops_restore_drills"."run_url" ~ '^https://[^[:space:]]+$')),
	CONSTRAINT "ops_restore_drills_commit_format" CHECK ("ops_restore_drills"."commit" is null or "ops_restore_drills"."commit" ~ '^[0-9a-f]{7,40}$'),
	CONSTRAINT "ops_restore_drills_tables_size" CHECK (octet_length("ops_restore_drills"."tables"::text) <= 65536),
	CONSTRAINT "ops_restore_drills_checks_size" CHECK (octet_length("ops_restore_drills"."checks"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"day" date NOT NULL,
	"mood" smallint,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_owner_day_key" UNIQUE("owner_id","day"),
	CONSTRAINT "journal_entries_mood_range" CHECK ("journal_entries"."mood" between 1 and 5),
	CONSTRAINT "journal_entries_text_length" CHECK (char_length("journal_entries"."text") <= 500),
	CONSTRAINT "journal_entries_not_empty" CHECK ("journal_entries"."mood" is not null or char_length("journal_entries"."text") > 0)
);
--> statement-breakpoint
CREATE TABLE "journal_settings" (
	"owner_id" text PRIMARY KEY DEFAULT app.current_user_id() NOT NULL,
	"prompt_enabled" boolean DEFAULT true NOT NULL,
	"prompt_time" time DEFAULT '21:30' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"expires_on" date NOT NULL,
	"issued_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"reminder_days" integer[] DEFAULT '{90,30,7,0}'::integer[] NOT NULL,
	"reminders_from" date DEFAULT current_date NOT NULL,
	"snoozed_until" date,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_documents_owner_id_key" UNIQUE("owner_id","id"),
	CONSTRAINT "documents_documents_name_length" CHECK (char_length("documents_documents"."name") between 1 and 80),
	CONSTRAINT "documents_documents_kind_valid" CHECK ("documents_documents"."kind" in ('passport', 'residence_permit', 'id_card', 'driving_licence', 'insurance', 'other')),
	CONSTRAINT "documents_documents_notes_length" CHECK (char_length("documents_documents"."notes") <= 500),
	CONSTRAINT "documents_documents_issued_before_expiry" CHECK ("documents_documents"."issued_on" is null or "documents_documents"."issued_on" <= "documents_documents"."expires_on"),
	CONSTRAINT "documents_documents_reminder_days_valid" CHECK (cardinality("documents_documents"."reminder_days") <= 8 and array_position("documents_documents"."reminder_days", null) is null and 0 <= all("documents_documents"."reminder_days") and 730 >= all("documents_documents"."reminder_days")),
	CONSTRAINT "documents_documents_history_valid" CHECK (jsonb_typeof("documents_documents"."history") = 'array' and jsonb_array_length("documents_documents"."history") <= 20)
);
--> statement-breakpoint
CREATE TABLE "documents_files" (
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"document_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_files_pkey" PRIMARY KEY("document_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "now_settings" (
	"owner_id" text PRIMARY KEY DEFAULT app.current_user_id() NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"show_goals" boolean DEFAULT true NOT NULL,
	"show_projects" boolean DEFAULT true NOT NULL,
	"show_writing" boolean DEFAULT true NOT NULL,
	"show_habits" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "now_settings_intro_length" CHECK (char_length("now_settings"."intro") <= 600),
	CONSTRAINT "now_settings_location_length" CHECK (char_length("now_settings"."location") <= 80)
);
--> statement-breakpoint
ALTER TABLE "osbot_deliveries" DROP CONSTRAINT "osbot_deliveries_kind_valid";--> statement-breakpoint
ALTER TABLE "ops_alert_settings" DROP CONSTRAINT "ops_alert_settings_kinds_valid";--> statement-breakpoint
ALTER TABLE "ops_alert_state" DROP CONSTRAINT "ops_alert_state_kind_valid";--> statement-breakpoint
ALTER TABLE "goals_goals" ADD COLUMN "show_on_now" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "osbot_settings" ADD CONSTRAINT "osbot_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_errors" ADD CONSTRAINT "ops_errors_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_restore_drills" ADD CONSTRAINT "ops_restore_drills_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_settings" ADD CONSTRAINT "journal_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_documents" ADD CONSTRAINT "documents_documents_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_files" ADD CONSTRAINT "documents_files_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_files" ADD CONSTRAINT "documents_files_file_id_files_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents_files" ADD CONSTRAINT "documents_files_document_fk" FOREIGN KEY ("owner_id","document_id") REFERENCES "public"."documents_documents"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "now_settings" ADD CONSTRAINT "now_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_fx_rates_currency_idx" ON "budget_fx_rates" USING btree ("currency","valid_on");--> statement-breakpoint
CREATE INDEX "ops_errors_owner_status_seen_idx" ON "ops_errors" USING btree ("owner_id","status","last_seen" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ops_errors_last_seen_idx" ON "ops_errors" USING btree ("last_seen");--> statement-breakpoint
CREATE INDEX "ops_restore_drills_owner_finished_idx" ON "ops_restore_drills" USING btree ("owner_id","finished_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_documents_owner_expires_idx" ON "documents_documents" USING btree ("owner_id","expires_on");--> statement-breakpoint
CREATE INDEX "documents_files_file_idx" ON "documents_files" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "documents_files_owner_idx" ON "documents_files" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "osbot_deliveries" ADD CONSTRAINT "osbot_deliveries_kind_valid" CHECK ("osbot_deliveries"."kind" in ('payment', 'weekly', 'budget-limit', 'monthly', 'brief', 'journal', 'document'));--> statement-breakpoint
ALTER TABLE "ops_alert_settings" ADD CONSTRAINT "ops_alert_settings_kinds_valid" CHECK ("ops_alert_settings"."disabled_kinds" <@ array['disk', 'memory', 'backup', 'cert', 'container', 'reboot', 'agent', 'files', 'errors', 'drill']::text[]);--> statement-breakpoint
ALTER TABLE "ops_alert_state" ADD CONSTRAINT "ops_alert_state_kind_valid" CHECK ("ops_alert_state"."kind" in ('disk', 'memory', 'backup', 'cert', 'container', 'reboot', 'agent', 'files', 'errors', 'drill'));