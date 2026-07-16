ALTER TABLE "guild_configs" DROP COLUMN "knockout_category_id";--> statement-breakpoint
ALTER TABLE "knockout_rounds" ADD COLUMN "category_id" text;
