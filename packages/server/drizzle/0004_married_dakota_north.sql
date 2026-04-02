CREATE TABLE "project_repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"github_repo_url" varchar(500) NOT NULL,
	"label" varchar(50),
	"github_webhook_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "github_repo_url";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "github_webhook_id";