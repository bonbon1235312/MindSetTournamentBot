ALTER TABLE "guild_configs" DROP COLUMN "group_category_id";--> statement-breakpoint
ALTER TABLE "guild_configs" DROP COLUMN "staff_category_id";--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "category_id" text;
