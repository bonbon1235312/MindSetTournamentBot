CREATE TYPE "public"."ticket_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"opened_by" text NOT NULL,
	"ticket_type" text NOT NULL,
	"status" "ticket_status" DEFAULT 'OPEN' NOT NULL,
	"claimed_by" text,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_guild_id_guild_configs_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_configs"("guild_id") ON DELETE cascade ON UPDATE no action;