ALTER TABLE "core_preferences" ADD COLUMN "theme_mode" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "core_preferences" ADD COLUMN "theme_schedule" text DEFAULT 'hours' NOT NULL;--> statement-breakpoint
ALTER TABLE "core_preferences" ADD COLUMN "theme_dark_from" text DEFAULT '20:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "core_preferences" ADD COLUMN "theme_dark_until" text DEFAULT '07:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "core_preferences" ADD COLUMN "theme_lat" double precision;--> statement-breakpoint
ALTER TABLE "core_preferences" ADD COLUMN "theme_lon" double precision;--> statement-breakpoint
ALTER TABLE "core_preferences" ADD COLUMN "theme_place" text;--> statement-breakpoint
ALTER TABLE "core_preferences" ADD COLUMN "today_order" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "core_preferences" ADD COLUMN "today_hidden" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "core_preferences" ADD CONSTRAINT "core_preferences_theme_mode" CHECK ("core_preferences"."theme_mode" in ('system', 'light', 'dark', 'scheduled'));--> statement-breakpoint
ALTER TABLE "core_preferences" ADD CONSTRAINT "core_preferences_theme_schedule" CHECK ("core_preferences"."theme_schedule" in ('hours', 'sun'));--> statement-breakpoint
ALTER TABLE "core_preferences" ADD CONSTRAINT "core_preferences_theme_hours" CHECK ("core_preferences"."theme_dark_from" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "core_preferences"."theme_dark_until" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
ALTER TABLE "core_preferences" ADD CONSTRAINT "core_preferences_theme_place" CHECK (("core_preferences"."theme_lat" is null) = ("core_preferences"."theme_lon" is null)
        and ("core_preferences"."theme_lat" is null or ("core_preferences"."theme_lat" between -90 and 90 and "core_preferences"."theme_lon" between -180 and 180))
        and ("core_preferences"."theme_place" is null or length("core_preferences"."theme_place") <= 80));--> statement-breakpoint
ALTER TABLE "core_preferences" ADD CONSTRAINT "core_preferences_theme_sun_place" CHECK ("core_preferences"."theme_schedule" <> 'sun' or "core_preferences"."theme_lat" is not null);--> statement-breakpoint
ALTER TABLE "core_preferences" ADD CONSTRAINT "core_preferences_today_size" CHECK (cardinality("core_preferences"."today_order") <= 100 and cardinality("core_preferences"."today_hidden") <= 100);