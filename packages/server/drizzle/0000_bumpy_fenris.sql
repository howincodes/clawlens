CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"auth_token" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"default_model" varchar(100) DEFAULT 'sonnet',
	"github_id" varchar(100),
	"avatar_url" varchar(500),
	"subscription_id" integer,
	"deployment_tier" varchar(20) DEFAULT 'standard',
	"poll_interval" integer DEFAULT 30000,
	"notification_config" text,
	"last_event_at" timestamp with time zone,
	"hook_integrity_hash" varchar(255),
	"killed_at" timestamp with time zone,
	"antigravity_collection" boolean DEFAULT true,
	"antigravity_interval" integer DEFAULT 120000,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_auth_token_unique" UNIQUE("auth_token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"model" varchar(100),
	"cwd" text,
	"source" varchar(50) DEFAULT 'claude_code',
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" varchar(100),
	"prompt_count" integer DEFAULT 0,
	"total_credits" real DEFAULT 0,
	"ai_summary" text,
	"ai_categories" text,
	"ai_productivity_score" integer,
	"ai_key_actions" text,
	"ai_tools_summary" text,
	"ai_analyzed_at" timestamp with time zone,
	"cli_version" varchar(50),
	"model_provider" varchar(50),
	"reasoning_effort" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(255),
	"user_id" integer NOT NULL,
	"prompt" text,
	"response" text,
	"model" varchar(100),
	"credit_cost" real DEFAULT 0,
	"blocked" boolean DEFAULT false,
	"block_reason" text,
	"source" varchar(50) DEFAULT 'claude_code',
	"turn_id" varchar(255),
	"input_tokens" integer,
	"cached_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" varchar(255),
	"event_type" varchar(50) NOT NULL,
	"payload" text,
	"source" varchar(50) DEFAULT 'claude_code',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subagent_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" varchar(255),
	"agent_id" varchar(255),
	"agent_type" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" varchar(255),
	"tool_name" varchar(100) NOT NULL,
	"tool_input" text,
	"tool_output" text,
	"success" boolean,
	"source" varchar(50) DEFAULT 'claude_code',
	"tool_use_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"model" varchar(100),
	"value" real NOT NULL,
	"window" varchar(20) DEFAULT 'daily',
	"start_hour" integer,
	"end_hour" integer,
	"timezone" varchar(50) DEFAULT 'UTC',
	"source" varchar(50) DEFAULT 'claude_code'
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"subscription_type" varchar(50) DEFAULT 'pro',
	"plan_name" varchar(100),
	"source" varchar(50) DEFAULT 'claude_code',
	"account_id" varchar(255),
	"org_id" varchar(255),
	"auth_provider" varchar(50),
	"subscription_active_start" varchar(50),
	"subscription_active_until" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"type" varchar(50) NOT NULL,
	"message" text NOT NULL,
	"resolved" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tamper_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"alert_type" varchar(50) NOT NULL,
	"details" text,
	"resolved" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watcher_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"command" varchar(50) NOT NULL,
	"payload" text,
	"status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watcher_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"hook_log" text,
	"watcher_log" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"session_id" varchar(255),
	"period" varchar(50),
	"summary" text NOT NULL,
	"categories" text,
	"topics" text,
	"risk_level" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_pulses" (
	"id" serial PRIMARY KEY NOT NULL,
	"pulse" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"profile" text NOT NULL,
	"version" integer DEFAULT 1,
	"prompt_count_at_update" integer DEFAULT 0,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"category" varchar(50) NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"project_id" integer DEFAULT 0 NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" integer,
	CONSTRAINT "user_roles_user_id_role_id_project_id_pk" PRIMARY KEY("user_id","role_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" integer,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"github_repo_url" varchar(500),
	"github_webhook_id" varchar(100),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(50) NOT NULL,
	"model" varchar(100) NOT NULL,
	"credits" integer DEFAULT 7,
	"tier" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "provider_quotas" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"source" varchar(50) NOT NULL,
	"window_name" varchar(50) NOT NULL,
	"plan_type" varchar(50),
	"used_percent" real,
	"window_minutes" integer,
	"resets_at" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limits" ADD CONSTRAINT "limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tamper_alerts" ADD CONSTRAINT "tamper_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watcher_commands" ADD CONSTRAINT "watcher_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watcher_logs" ADD CONSTRAINT "watcher_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_quotas" ADD CONSTRAINT "provider_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_credits_source_model_idx" ON "model_credits" USING btree ("source","model");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_quotas_user_source_window_idx" ON "provider_quotas" USING btree ("user_id","source","window_name");