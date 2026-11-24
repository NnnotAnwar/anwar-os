CREATE TABLE "goals_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"year" integer NOT NULL,
	"title" text NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"target_value" double precision,
	"target_unit" text DEFAULT '' NOT NULL,
	"current_value" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_goals_title_length" CHECK (char_length("goals_goals"."title") between 1 and 120),
	CONSTRAINT "goals_goals_why_length" CHECK (char_length("goals_goals"."why") <= 1000),
	CONSTRAINT "goals_goals_unit_length" CHECK (char_length("goals_goals"."target_unit") <= 30),
	CONSTRAINT "goals_goals_year_range" CHECK ("goals_goals"."year" between 2000 and 2100),
	CONSTRAINT "goals_goals_target_positive" CHECK ("goals_goals"."target_value" is null or "goals_goals"."target_value" > 0),
	CONSTRAINT "goals_goals_current_nonnegative" CHECK ("goals_goals"."current_value" >= 0),
	CONSTRAINT "goals_goals_status_valid" CHECK ("goals_goals"."status" in ('active', 'done', 'dropped'))
);
--> statement-breakpoint
CREATE TABLE "goals_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"goal_id" uuid NOT NULL,
	"task_id" uuid,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_links_one_target" CHECK (num_nonnulls("goals_links"."task_id", "goals_links"."project_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "goals_goals" ADD CONSTRAINT "goals_goals_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals_links" ADD CONSTRAINT "goals_links_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals_links" ADD CONSTRAINT "goals_links_goal_id_goals_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals_links" ADD CONSTRAINT "goals_links_task_id_tasks_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals_links" ADD CONSTRAINT "goals_links_project_id_projects_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_goals_owner_year_idx" ON "goals_goals" USING btree ("owner_id","year","sort_order");--> statement-breakpoint
CREATE INDEX "goals_links_goal_idx" ON "goals_links" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goals_links_task_key" ON "goals_links" USING btree ("task_id") WHERE "goals_links"."task_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "goals_links_project_key" ON "goals_links" USING btree ("project_id") WHERE "goals_links"."project_id" is not null;