CREATE TABLE "calendar_reminder_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"event_id" uuid NOT NULL,
	"occurrence_start" timestamp with time zone NOT NULL,
	"minutes_before" integer NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_reminder_deliveries_key" UNIQUE("event_id","occurrence_start","minutes_before"),
	CONSTRAINT "calendar_reminder_deliveries_minutes_range" CHECK ("calendar_reminder_deliveries"."minutes_before" between 0 and 40320)
);
--> statement-breakpoint
CREATE TABLE "osbot_feedback_alerts" (
	"feedback_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"channel" text DEFAULT 'osbot' NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "osbot_feedback_alerts_channel_valid" CHECK ("osbot_feedback_alerts"."channel" in ('osbot', 'direct'))
);
--> statement-breakpoint
CREATE TABLE "osbot_heartbeats" (
	"owner_id" text PRIMARY KEY DEFAULT app.current_user_id() NOT NULL,
	"version" text DEFAULT 'dev' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_beat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "osbot_heartbeats_version_length" CHECK (char_length("osbot_heartbeats"."version") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "calendar_reminder_deliveries" ADD CONSTRAINT "calendar_reminder_deliveries_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_reminder_deliveries" ADD CONSTRAINT "calendar_reminder_deliveries_event_fk" FOREIGN KEY ("owner_id","event_id") REFERENCES "public"."calendar_events"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osbot_feedback_alerts" ADD CONSTRAINT "osbot_feedback_alerts_feedback_id_feedback_items_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osbot_feedback_alerts" ADD CONSTRAINT "osbot_feedback_alerts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osbot_heartbeats" ADD CONSTRAINT "osbot_heartbeats_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_reminder_deliveries_owner_delivered_idx" ON "calendar_reminder_deliveries" USING btree ("owner_id","delivered_at");