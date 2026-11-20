CREATE TABLE "budget_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'bank' NOT NULL,
	"currency" char(3) DEFAULT 'CZK' NOT NULL,
	"opening_balance_minor" bigint DEFAULT 0 NOT NULL,
	"opened_on" date DEFAULT current_date NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_accounts_owner_id_key" UNIQUE("owner_id","id"),
	CONSTRAINT "budget_accounts_owner_id_currency_key" UNIQUE("owner_id","id","currency"),
	CONSTRAINT "budget_accounts_name_length" CHECK (char_length("budget_accounts"."name") between 1 and 80),
	CONSTRAINT "budget_accounts_kind_valid" CHECK ("budget_accounts"."kind" in ('cash', 'bank', 'savings', 'investment')),
	CONSTRAINT "budget_accounts_currency_shape" CHECK ("budget_accounts"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "budget_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'expense' NOT NULL,
	"parent_id" uuid,
	"color" text DEFAULT 'accent-500' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_categories_owner_id_key" UNIQUE("owner_id","id"),
	CONSTRAINT "budget_categories_name_length" CHECK (char_length("budget_categories"."name") between 1 and 60),
	CONSTRAINT "budget_categories_kind_valid" CHECK ("budget_categories"."kind" in ('income', 'expense')),
	CONSTRAINT "budget_categories_color_shape" CHECK ("budget_categories"."color" ~ '^[a-z0-9-]{1,32}$'),
	CONSTRAINT "budget_categories_not_own_parent" CHECK ("budget_categories"."parent_id" is distinct from "budget_categories"."id")
);
--> statement-breakpoint
CREATE TABLE "budget_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"target_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'CZK' NOT NULL,
	"deadline" date,
	"account_id" uuid,
	"saved_minor" bigint DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_goals_name_length" CHECK (char_length("budget_goals"."name") between 1 and 80),
	CONSTRAINT "budget_goals_target_positive" CHECK ("budget_goals"."target_minor" > 0),
	CONSTRAINT "budget_goals_saved_nonnegative" CHECK ("budget_goals"."saved_minor" >= 0),
	CONSTRAINT "budget_goals_currency_shape" CHECK ("budget_goals"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "budget_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"starting_capital_minor" bigint DEFAULT 0 NOT NULL,
	"monthly_contribution_minor" bigint DEFAULT 0 NOT NULL,
	"annual_return_bp" integer DEFAULT 700 NOT NULL,
	"horizon_years" integer DEFAULT 10 NOT NULL,
	"start_on" date NOT NULL,
	"currency" char(3) DEFAULT 'CZK' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_plans_owner_key" UNIQUE("owner_id"),
	CONSTRAINT "budget_plans_starting_nonnegative" CHECK ("budget_plans"."starting_capital_minor" >= 0),
	CONSTRAINT "budget_plans_monthly_nonnegative" CHECK ("budget_plans"."monthly_contribution_minor" >= 0),
	CONSTRAINT "budget_plans_return_range" CHECK ("budget_plans"."annual_return_bp" between -5000 and 10000),
	CONSTRAINT "budget_plans_horizon_range" CHECK ("budget_plans"."horizon_years" between 1 and 60),
	CONSTRAINT "budget_plans_start_first_of_month" CHECK (extract(day from "budget_plans"."start_on") = 1),
	CONSTRAINT "budget_plans_currency_shape" CHECK ("budget_plans"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "budget_recurring" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"account_id" uuid NOT NULL,
	"currency" char(3) DEFAULT 'CZK' NOT NULL,
	"category_id" uuid,
	"amount_minor" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"freq" text DEFAULT 'monthly' NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"start_on" date NOT NULL,
	"next_due" date NOT NULL,
	"end_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_recurring_owner_id_key" UNIQUE("owner_id","id"),
	CONSTRAINT "budget_recurring_amount_nonzero" CHECK ("budget_recurring"."amount_minor" <> 0),
	CONSTRAINT "budget_recurring_note_length" CHECK (char_length("budget_recurring"."note") <= 200),
	CONSTRAINT "budget_recurring_freq_valid" CHECK ("budget_recurring"."freq" in ('weekly', 'monthly', 'yearly')),
	CONSTRAINT "budget_recurring_interval_range" CHECK ("budget_recurring"."interval" between 1 and 52),
	CONSTRAINT "budget_recurring_next_after_start" CHECK ("budget_recurring"."next_due" >= "budget_recurring"."start_on"),
	CONSTRAINT "budget_recurring_end_after_start" CHECK ("budget_recurring"."end_on" is null or "budget_recurring"."end_on" >= "budget_recurring"."start_on")
);
--> statement-breakpoint
CREATE TABLE "budget_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"base_currency" char(3) DEFAULT 'CZK' NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_settings_owner_key" UNIQUE("owner_id"),
	CONSTRAINT "budget_settings_currency_shape" CHECK ("budget_settings"."base_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "budget_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"account_id" uuid NOT NULL,
	"currency" char(3) DEFAULT 'CZK' NOT NULL,
	"category_id" uuid,
	"amount_minor" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"recurring_id" uuid,
	"transfer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_transactions_recurring_date_key" UNIQUE("recurring_id","occurred_on"),
	CONSTRAINT "budget_transactions_amount_nonzero" CHECK ("budget_transactions"."amount_minor" <> 0),
	CONSTRAINT "budget_transactions_note_length" CHECK (char_length("budget_transactions"."note") <= 500),
	CONSTRAINT "budget_transactions_tags_count" CHECK (cardinality("budget_transactions"."tags") <= 20)
);
--> statement-breakpoint
ALTER TABLE "budget_accounts" ADD CONSTRAINT "budget_accounts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_goals" ADD CONSTRAINT "budget_goals_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_recurring" ADD CONSTRAINT "budget_recurring_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_recurring" ADD CONSTRAINT "budget_recurring_account_fk" FOREIGN KEY ("owner_id","account_id","currency") REFERENCES "public"."budget_accounts"("owner_id","id","currency") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "budget_settings" ADD CONSTRAINT "budget_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_transactions" ADD CONSTRAINT "budget_transactions_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_transactions" ADD CONSTRAINT "budget_transactions_account_fk" FOREIGN KEY ("owner_id","account_id","currency") REFERENCES "public"."budget_accounts"("owner_id","id","currency") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "budget_accounts_owner_idx" ON "budget_accounts" USING btree ("owner_id","archived","name");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_categories_owner_name_key" ON "budget_categories" USING btree ("owner_id","kind",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "budget_goals_owner_idx" ON "budget_goals" USING btree ("owner_id","archived");--> statement-breakpoint
CREATE INDEX "budget_recurring_owner_due_idx" ON "budget_recurring" USING btree ("owner_id","active","next_due");--> statement-breakpoint
CREATE INDEX "budget_transactions_owner_date_idx" ON "budget_transactions" USING btree ("owner_id","occurred_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "budget_transactions_owner_account_date_idx" ON "budget_transactions" USING btree ("owner_id","account_id","occurred_on");--> statement-breakpoint
CREATE INDEX "budget_transactions_owner_category_idx" ON "budget_transactions" USING btree ("owner_id","category_id");--> statement-breakpoint
CREATE INDEX "budget_transactions_transfer_idx" ON "budget_transactions" USING btree ("transfer_id");