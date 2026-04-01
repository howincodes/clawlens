CREATE TABLE "session_raw_jsonl" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"project_path" text,
	"raw_content" text NOT NULL,
	"line_count" integer,
	"last_offset" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "raw_model" varchar(255);--> statement-breakpoint
ALTER TABLE "session_raw_jsonl" ADD CONSTRAINT "session_raw_jsonl_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_raw_jsonl_user_session_idx" ON "session_raw_jsonl" USING btree ("user_id","session_id");