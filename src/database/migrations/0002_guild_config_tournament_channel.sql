ALTER TABLE "guild_configs" ADD COLUMN "tournament_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_configs" DROP COLUMN "tournament_channels";
