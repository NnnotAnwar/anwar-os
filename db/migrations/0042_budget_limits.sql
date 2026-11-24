CREATE TABLE "budget_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_limits_owner_category_key" UNIQUE("owner_id","category_id"),
	CONSTRAINT "budget_limits_amount_positive" CHECK ("budget_limits"."amount_minor" > 0 and "budget_limits"."amount_minor" < 100000000000000)
);
--> statement-breakpoint
ALTER TABLE "osbot_deliveries" DROP CONSTRAINT "osbot_deliveries_kind_valid";--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_category_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."budget_categories"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "osbot_deliveries" ADD CONSTRAINT "osbot_deliveries_kind_valid" CHECK ("osbot_deliveries"."kind" in ('payment', 'weekly', 'budget-limit'));