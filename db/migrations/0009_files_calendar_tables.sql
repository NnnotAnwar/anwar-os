CREATE TABLE "files_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"folder_id" uuid,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_documents_title_length" CHECK (char_length("files_documents"."title") between 1 and 200),
	CONSTRAINT "files_documents_body_length" CHECK (char_length("files_documents"."body") <= 200000)
);
--> statement-breakpoint
CREATE TABLE "files_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime" text NOT NULL,
	"storage_key" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_files_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "files_files_name_length" CHECK (char_length("files_files"."name") between 1 and 255),
	CONSTRAINT "files_files_size_range" CHECK ("files_files"."size_bytes" between 0 and 104857600),
	CONSTRAINT "files_files_description_length" CHECK (char_length("files_files"."description") <= 2000),
	CONSTRAINT "files_files_tags_count" CHECK (cardinality("files_files"."tags") <= 20),
	CONSTRAINT "files_files_key_in_owner_prefix" CHECK (starts_with("files_files"."storage_key", "files_files"."owner_id" || '/'))
);
--> statement-breakpoint
CREATE TABLE "files_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_folders_owner_id_key" UNIQUE("owner_id","id"),
	CONSTRAINT "files_folders_sibling_name_key" UNIQUE NULLS NOT DISTINCT("owner_id","parent_id","name"),
	CONSTRAINT "files_folders_name_valid" CHECK (char_length("files_folders"."name") between 1 and 120 and "files_folders"."name" !~ '[/\\]'),
	CONSTRAINT "files_folders_not_own_parent" CHECK ("files_folders"."parent_id" is distinct from "files_folders"."id")
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'personal' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'Europe/Prague' NOT NULL,
	"rrule" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_owner_id_key" UNIQUE("owner_id","id"),
	CONSTRAINT "calendar_events_title_length" CHECK (char_length("calendar_events"."title") between 1 and 200),
	CONSTRAINT "calendar_events_notes_length" CHECK (char_length("calendar_events"."notes") <= 10000),
	CONSTRAINT "calendar_events_location_length" CHECK (char_length("calendar_events"."location") <= 300),
	CONSTRAINT "calendar_events_rrule_length" CHECK (char_length("calendar_events"."rrule") <= 300),
	CONSTRAINT "calendar_events_timezone_length" CHECK (char_length("calendar_events"."timezone") between 1 and 64),
	CONSTRAINT "calendar_events_ends_after_start" CHECK ("calendar_events"."end_at" >= "calendar_events"."start_at"),
	CONSTRAINT "calendar_events_category_valid" CHECK ("calendar_events"."category" in ('personal', 'work', 'health', 'social', 'travel', 'birthday', 'deadline'))
);
--> statement-breakpoint
CREATE TABLE "calendar_feed_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"selector" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feed_tokens_owner_key" UNIQUE("owner_id"),
	CONSTRAINT "calendar_feed_tokens_selector_key" UNIQUE("selector"),
	CONSTRAINT "calendar_feed_tokens_token_shape" CHECK ("calendar_feed_tokens"."token" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "calendar_feed_tokens_selector_prefix" CHECK (starts_with("calendar_feed_tokens"."token", "calendar_feed_tokens"."selector"))
);
--> statement-breakpoint
CREATE TABLE "calendar_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"event_id" uuid NOT NULL,
	"minutes_before" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_reminders_event_minutes_key" UNIQUE("event_id","minutes_before"),
	CONSTRAINT "calendar_reminders_minutes_range" CHECK ("calendar_reminders"."minutes_before" between 0 and 40320)
);
--> statement-breakpoint
ALTER TABLE "files_documents" ADD CONSTRAINT "files_documents_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files_documents" ADD CONSTRAINT "files_documents_folder_fk" FOREIGN KEY ("owner_id","folder_id") REFERENCES "public"."files_folders"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files_files" ADD CONSTRAINT "files_files_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files_files" ADD CONSTRAINT "files_files_folder_fk" FOREIGN KEY ("owner_id","folder_id") REFERENCES "public"."files_folders"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files_folders" ADD CONSTRAINT "files_folders_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files_folders" ADD CONSTRAINT "files_folders_parent_fk" FOREIGN KEY ("owner_id","parent_id") REFERENCES "public"."files_folders"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feed_tokens" ADD CONSTRAINT "calendar_feed_tokens_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_event_fk" FOREIGN KEY ("owner_id","event_id") REFERENCES "public"."calendar_events"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_documents_owner_folder_idx" ON "files_documents" USING btree ("owner_id","folder_id");--> statement-breakpoint
CREATE INDEX "files_documents_owner_updated_idx" ON "files_documents" USING btree ("owner_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "files_files_owner_folder_idx" ON "files_files" USING btree ("owner_id","folder_id");--> statement-breakpoint
CREATE INDEX "files_files_owner_created_idx" ON "files_files" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "files_folders_owner_parent_idx" ON "files_folders" USING btree ("owner_id","parent_id");--> statement-breakpoint
CREATE INDEX "calendar_events_owner_start_idx" ON "calendar_events" USING btree ("owner_id","start_at");--> statement-breakpoint
CREATE INDEX "calendar_reminders_owner_event_idx" ON "calendar_reminders" USING btree ("owner_id","event_id");