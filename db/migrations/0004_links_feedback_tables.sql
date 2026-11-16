CREATE TABLE "links_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"site_name" text DEFAULT '' NOT NULL,
	"favicon_url" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"read_later" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_links_url_length" CHECK (char_length("links_links"."url") between 1 and 2048),
	CONSTRAINT "links_links_url_scheme" CHECK ("links_links"."url" ~* '^https?://'),
	CONSTRAINT "links_links_title_length" CHECK (char_length("links_links"."title") between 1 and 300),
	CONSTRAINT "links_links_description_length" CHECK (char_length("links_links"."description") <= 1000),
	CONSTRAINT "links_links_site_name_length" CHECK (char_length("links_links"."site_name") <= 200),
	CONSTRAINT "links_links_favicon_length" CHECK (char_length("links_links"."favicon_url") <= 2048),
	CONSTRAINT "links_links_note_length" CHECK (char_length("links_links"."note") <= 5000),
	CONSTRAINT "links_links_tags_count" CHECK (cardinality("links_links"."tags") <= 20)
);
--> statement-breakpoint
CREATE TABLE "feedback_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text DEFAULT app.current_user_id() NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"name" text,
	"contact" text,
	"status" text DEFAULT 'new' NOT NULL,
	"reply_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_items_kind_valid" CHECK ("feedback_items"."kind" in ('complaint', 'suggestion', 'question', 'thanks')),
	CONSTRAINT "feedback_items_status_valid" CHECK ("feedback_items"."status" in ('new', 'read', 'in_progress', 'done', 'spam')),
	CONSTRAINT "feedback_items_message_length" CHECK (char_length("feedback_items"."message") between 10 and 5000),
	CONSTRAINT "feedback_items_name_length" CHECK (char_length("feedback_items"."name") <= 100),
	CONSTRAINT "feedback_items_contact_length" CHECK (char_length("feedback_items"."contact") <= 200),
	CONSTRAINT "feedback_items_reply_note_length" CHECK (char_length("feedback_items"."reply_note") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "feedback_submissions" (
	"challenge" text PRIMARY KEY NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "links_links" ADD CONSTRAINT "links_links_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "links_links_owner_created_idx" ON "links_links" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "links_links_owner_url_key" ON "links_links" USING btree ("owner_id","url");--> statement-breakpoint
CREATE INDEX "links_links_tags_idx" ON "links_links" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "feedback_items_owner_created_idx" ON "feedback_items" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feedback_items_owner_status_idx" ON "feedback_items" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "feedback_submissions_ip_created_idx" ON "feedback_submissions" USING btree ("ip_hash","created_at" DESC NULLS LAST);