CREATE TABLE "assistant_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"model" text NOT NULL,
	"pending" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_conversations_owner_id_key" UNIQUE("owner_id","id"),
	CONSTRAINT "assistant_conversations_title_length" CHECK (char_length("assistant_conversations"."title") between 1 and 120),
	CONSTRAINT "assistant_conversations_model_length" CHECK (char_length("assistant_conversations"."model") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "assistant_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_messages_kind" CHECK ("assistant_messages"."kind" in ('user', 'assistant', 'tool_results'))
);
--> statement-breakpoint
CREATE TABLE "assistant_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"conversation_id" uuid,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_usage_kind" CHECK ("assistant_usage"."kind" in ('chat', 'receipt')),
	CONSTRAINT "assistant_usage_tokens_nonnegative" CHECK ("assistant_usage"."input_tokens" >= 0 and "assistant_usage"."output_tokens" >= 0 and "assistant_usage"."cache_read_tokens" >= 0 and "assistant_usage"."cache_write_tokens" >= 0 and "assistant_usage"."cost_micro_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_conversations_owner_updated_idx" ON "assistant_conversations" USING btree ("owner_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "assistant_messages_conversation_seq_idx" ON "assistant_messages" USING btree ("owner_id","conversation_id","seq");--> statement-breakpoint
CREATE INDEX "assistant_usage_owner_created_idx" ON "assistant_usage" USING btree ("owner_id","created_at" DESC NULLS LAST);