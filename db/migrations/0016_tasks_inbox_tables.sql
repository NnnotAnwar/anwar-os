CREATE TABLE "tasks_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_lists_name_length" CHECK (char_length("tasks_lists"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "tasks_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"due_date" date,
	"due_time" time,
	"priority" text DEFAULT 'none' NOT NULL,
	"list_id" uuid,
	"project_id" uuid,
	"rrule" text,
	"spawned_from" uuid,
	"done_at" timestamp with time zone,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_tasks_title_length" CHECK (char_length("tasks_tasks"."title") between 1 and 300),
	CONSTRAINT "tasks_tasks_notes_length" CHECK (char_length("tasks_tasks"."notes") <= 20000),
	CONSTRAINT "tasks_tasks_priority_valid" CHECK ("tasks_tasks"."priority" in ('none', 'low', 'high')),
	CONSTRAINT "tasks_tasks_rrule_length" CHECK (char_length("tasks_tasks"."rrule") <= 300),
	CONSTRAINT "tasks_tasks_time_needs_date" CHECK ("tasks_tasks"."due_time" is null or "tasks_tasks"."due_date" is not null),
	CONSTRAINT "tasks_tasks_repeat_needs_date" CHECK ("tasks_tasks"."rrule" is null or "tasks_tasks"."due_date" is not null)
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"url" text,
	"source" text DEFAULT 'app' NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_as" text,
	"processed_ref" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_items_text_length" CHECK (char_length("inbox_items"."text") <= 10000),
	CONSTRAINT "inbox_items_url_shape" CHECK ("inbox_items"."url" is null or (char_length("inbox_items"."url") <= 2000 and "inbox_items"."url" ~* '^https?://')),
	CONSTRAINT "inbox_items_not_empty" CHECK (char_length(btrim("inbox_items"."text")) > 0 or "inbox_items"."url" is not null),
	CONSTRAINT "inbox_items_source_valid" CHECK ("inbox_items"."source" in ('app', 'share', 'telegram', 'api')),
	CONSTRAINT "inbox_items_outcome_valid" CHECK ("inbox_items"."processed_as" is null or "inbox_items"."processed_as" in ('task', 'note', 'link', 'idea', 'event')),
	CONSTRAINT "inbox_items_processed_consistent" CHECK (("inbox_items"."processed_at" is null) = ("inbox_items"."processed_as" is null))
);
--> statement-breakpoint
ALTER TABLE "tasks_lists" ADD CONSTRAINT "tasks_lists_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks_tasks" ADD CONSTRAINT "tasks_tasks_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks_tasks" ADD CONSTRAINT "tasks_tasks_list_id_tasks_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."tasks_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks_tasks" ADD CONSTRAINT "tasks_tasks_project_id_projects_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks_tasks" ADD CONSTRAINT "tasks_tasks_spawned_from_tasks_tasks_id_fk" FOREIGN KEY ("spawned_from") REFERENCES "public"."tasks_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_lists_owner_name_key" ON "tasks_lists" USING btree ("owner_id",lower("name"));--> statement-breakpoint
CREATE INDEX "tasks_lists_owner_order_idx" ON "tasks_lists" USING btree ("owner_id","sort_order");--> statement-breakpoint
CREATE INDEX "tasks_tasks_owner_open_due_idx" ON "tasks_tasks" USING btree ("owner_id","due_date") WHERE "tasks_tasks"."done_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_tasks_owner_list_order_idx" ON "tasks_tasks" USING btree ("owner_id","list_id","sort_order");--> statement-breakpoint
CREATE INDEX "tasks_tasks_owner_done_idx" ON "tasks_tasks" USING btree ("owner_id","done_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tasks_tasks_spawned_from_idx" ON "tasks_tasks" USING btree ("spawned_from");--> statement-breakpoint
CREATE INDEX "inbox_items_owner_open_idx" ON "inbox_items" USING btree ("owner_id","created_at") WHERE "inbox_items"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "inbox_items_owner_processed_idx" ON "inbox_items" USING btree ("owner_id","processed_at" DESC NULLS LAST);