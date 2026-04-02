CREATE TABLE "usage_polls" (
	"id" serial PRIMARY KEY NOT NULL,
	"credential_id" integer NOT NULL,
	"five_hour_utilization" real,
	"seven_day_utilization" real,
	"opus_weekly_utilization" real,
	"sonnet_weekly_utilization" real,
	"five_hour_resets_at" timestamp with time zone,
	"seven_day_resets_at" timestamp with time zone,
	"assigned_user_ids" text,
	"polled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_polls" ADD CONSTRAINT "usage_polls_credential_id_subscription_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."subscription_credentials"("id") ON DELETE cascade ON UPDATE no action;