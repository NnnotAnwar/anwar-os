ALTER TABLE "documents_files" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "documents_files" ADD CONSTRAINT "documents_files_document_side_key" UNIQUE("document_id","side");--> statement-breakpoint
ALTER TABLE "documents_files" ADD CONSTRAINT "documents_files_side_valid" CHECK ("documents_files"."side" is null or "documents_files"."side" in ('front', 'back'));