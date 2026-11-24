CREATE TABLE "osbot_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "osbot_deliveries_key" UNIQUE("owner_id","kind","key"),
	CONSTRAINT "osbot_deliveries_kind_valid" CHECK ("osbot_deliveries"."kind" in ('payment', 'weekly')),
	CONSTRAINT "osbot_deliveries_key_length" CHECK (char_length("osbot_deliveries"."key") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "budget_recurring" ADD COLUMN "subscription" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "osbot_deliveries" ADD CONSTRAINT "osbot_deliveries_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "osbot_deliveries_owner_delivered_idx" ON "osbot_deliveries" USING btree ("owner_id","delivered_at");