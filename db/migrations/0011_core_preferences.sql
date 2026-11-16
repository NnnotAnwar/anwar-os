CREATE TABLE "core_preferences" (
	"owner_id" text PRIMARY KEY DEFAULT app.current_user_id() NOT NULL,
	"pinned_services" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core_preferences" ADD CONSTRAINT "core_preferences_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;