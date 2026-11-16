CREATE TABLE "cv_education" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"institution" text NOT NULL,
	"degree" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"start_on" date,
	"end_on" date,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_education_institution_length" CHECK (char_length("cv_education"."institution") between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "cv_experience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"role" text NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"start_on" date,
	"end_on" date,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_experience_role_length" CHECK (char_length("cv_experience"."role") between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "cv_languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"level" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_languages_name_length" CHECK (char_length("cv_languages"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "cv_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_profile_contacts_array" CHECK (jsonb_typeof("cv_profile"."contacts") = 'array')
);
--> statement-breakpoint
CREATE TABLE "cv_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_skills_name_length" CHECK (char_length("cv_skills"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "projects_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"stack" text[] DEFAULT '{}'::text[] NOT NULL,
	"live_url" text,
	"repo_url" text,
	"demo_url" text,
	"cover_url" text,
	"featured" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_projects_title_length" CHECK (char_length("projects_projects"."title") between 1 and 120),
	CONSTRAINT "projects_projects_slug_format" CHECK ("projects_projects"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("projects_projects"."slug") <= 80),
	CONSTRAINT "projects_projects_status_valid" CHECK ("projects_projects"."status" in ('idea', 'building', 'live', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "ideas_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'raw' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ideas_ideas_title_length" CHECK (char_length("ideas_ideas"."title") between 1 and 200),
	CONSTRAINT "ideas_ideas_status_valid" CHECK ("ideas_ideas"."status" in ('raw', 'exploring', 'building', 'shipped', 'dropped'))
);
--> statement-breakpoint
ALTER TABLE "cv_education" ADD CONSTRAINT "cv_education_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_experience" ADD CONSTRAINT "cv_experience_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_languages" ADD CONSTRAINT "cv_languages_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_profile" ADD CONSTRAINT "cv_profile_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_skills" ADD CONSTRAINT "cv_skills_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects_projects" ADD CONSTRAINT "projects_projects_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas_ideas" ADD CONSTRAINT "ideas_ideas_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cv_education_owner_order_idx" ON "cv_education" USING btree ("owner_id","sort_order");--> statement-breakpoint
CREATE INDEX "cv_experience_owner_order_idx" ON "cv_experience" USING btree ("owner_id","sort_order");--> statement-breakpoint
CREATE INDEX "cv_languages_owner_order_idx" ON "cv_languages" USING btree ("owner_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "cv_profile_owner_key" ON "cv_profile" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "cv_skills_owner_order_idx" ON "cv_skills" USING btree ("owner_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_projects_owner_slug_key" ON "projects_projects" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE INDEX "projects_projects_owner_order_idx" ON "projects_projects" USING btree ("owner_id","sort_order","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ideas_ideas_owner_status_idx" ON "ideas_ideas" USING btree ("owner_id","status","updated_at" DESC NULLS LAST);