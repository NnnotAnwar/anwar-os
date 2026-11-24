CREATE TABLE "core_api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{read}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_api_tokens_prefix_unique" UNIQUE("prefix"),
	CONSTRAINT "core_api_tokens_name_length" CHECK (char_length("core_api_tokens"."name") between 1 and 60),
	CONSTRAINT "core_api_tokens_prefix_format" CHECK ("core_api_tokens"."prefix" ~ '^aos_[A-Za-z0-9]{8}$'),
	CONSTRAINT "core_api_tokens_hash_format" CHECK ("core_api_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "core_api_tokens_scopes_valid" CHECK ("core_api_tokens"."scopes" <@ array['read', 'write']::text[] and 'read' = any("core_api_tokens"."scopes"))
);
--> statement-breakpoint
ALTER TABLE "core_api_tokens" ADD CONSTRAINT "core_api_tokens_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "core_api_tokens_owner_created_idx" ON "core_api_tokens" USING btree ("owner_id","created_at");