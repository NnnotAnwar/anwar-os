CREATE TABLE "analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"day" date NOT NULL,
	"path" text NOT NULL,
	"referrer_host" text DEFAULT '' NOT NULL,
	"device" text NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_device_valid" CHECK ("analytics_daily"."device" in ('desktop', 'mobile', 'tablet')),
	CONSTRAINT "analytics_daily_path_length" CHECK (char_length("analytics_daily"."path") between 1 and 120),
	CONSTRAINT "analytics_daily_referrer_length" CHECK (char_length("analytics_daily"."referrer_host") <= 253),
	CONSTRAINT "analytics_daily_country_format" CHECK ("analytics_daily"."country" = '' or "analytics_daily"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "analytics_daily_views_positive" CHECK ("analytics_daily"."views" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_rate" (
	"minute" timestamp with time zone PRIMARY KEY NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes_notes" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notes_notes" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "notes_notes" ADD COLUMN "excerpt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "notes_notes" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_bucket_key" ON "analytics_daily" USING btree ("owner_id","day","path","referrer_host","device","country");--> statement-breakpoint
CREATE INDEX "analytics_daily_owner_day_idx" ON "analytics_daily" USING btree ("owner_id","day" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notes_notes_owner_slug_key" ON "notes_notes" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE INDEX "notes_notes_published_idx" ON "notes_notes" USING btree ("owner_id","published_at" DESC NULLS LAST) WHERE "notes_notes"."is_public";--> statement-breakpoint
ALTER TABLE "notes_notes" ADD CONSTRAINT "notes_notes_slug_format" CHECK ("notes_notes"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("notes_notes"."slug") <= 80);--> statement-breakpoint
ALTER TABLE "notes_notes" ADD CONSTRAINT "notes_notes_excerpt_length" CHECK (char_length("notes_notes"."excerpt") <= 300);--> statement-breakpoint
ALTER TABLE "notes_notes" ADD CONSTRAINT "notes_notes_published_complete" CHECK (not "notes_notes"."is_public" or ("notes_notes"."slug" is not null and "notes_notes"."published_at" is not null));