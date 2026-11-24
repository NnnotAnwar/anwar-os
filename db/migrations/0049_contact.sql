CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"topic" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_messages_topic_valid" CHECK ("contact_messages"."topic" in ('job', 'freelance', 'other')),
	CONSTRAINT "contact_messages_status_valid" CHECK ("contact_messages"."status" in ('new', 'replied', 'archived')),
	CONSTRAINT "contact_messages_name_length" CHECK (char_length("contact_messages"."name") between 1 and 100),
	CONSTRAINT "contact_messages_email_length" CHECK (char_length("contact_messages"."email") between 3 and 200),
	CONSTRAINT "contact_messages_company_length" CHECK (char_length("contact_messages"."company") <= 120),
	CONSTRAINT "contact_messages_message_length" CHECK (char_length("contact_messages"."message") between 10 and 5000)
);
--> statement-breakpoint
CREATE TABLE "contact_submissions" (
	"token" text PRIMARY KEY NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_messages_owner_created_idx" ON "contact_messages" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contact_messages_owner_status_idx" ON "contact_messages" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "contact_submissions_ip_created_idx" ON "contact_submissions" USING btree ("ip_hash","created_at" DESC NULLS LAST);