CREATE TABLE "model_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_name" varchar(255) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"family" varchar(50),
	"tier" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_aliases_raw_name_unique" UNIQUE("raw_name")
);
