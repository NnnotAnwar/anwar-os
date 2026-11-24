CREATE TABLE "habits_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"habit_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habits_checks_habit_day_key" UNIQUE("habit_id","day")
);
--> statement-breakpoint
CREATE TABLE "habits_habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '' NOT NULL,
	"weekdays" integer DEFAULT 127 NOT NULL,
	"reminder_time" time,
	"last_reminded_on" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habits_habits_owner_id_key" UNIQUE("owner_id","id"),
	CONSTRAINT "habits_habits_name_length" CHECK (char_length("habits_habits"."name") between 1 and 80),
	CONSTRAINT "habits_habits_emoji_length" CHECK (char_length("habits_habits"."emoji") <= 16),
	CONSTRAINT "habits_habits_weekdays_range" CHECK ("habits_habits"."weekdays" between 1 and 127)
);
--> statement-breakpoint
CREATE TABLE "habits_settings" (
	"owner_id" text PRIMARY KEY DEFAULT app.current_user_id() NOT NULL,
	"nudge_enabled" boolean DEFAULT false NOT NULL,
	"nudge_time" time DEFAULT '21:00' NOT NULL,
	"last_nudged_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "habits_checks" ADD CONSTRAINT "habits_checks_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits_checks" ADD CONSTRAINT "habits_checks_habit_fk" FOREIGN KEY ("owner_id","habit_id") REFERENCES "public"."habits_habits"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits_habits" ADD CONSTRAINT "habits_habits_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits_settings" ADD CONSTRAINT "habits_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "habits_checks_owner_day_idx" ON "habits_checks" USING btree ("owner_id","day");--> statement-breakpoint
CREATE INDEX "habits_habits_owner_order_idx" ON "habits_habits" USING btree ("owner_id","sort_order");