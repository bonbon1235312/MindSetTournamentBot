CREATE TYPE "public"."actor_type" AS ENUM('USER', 'ADMIN', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."confirmation_status" AS ENUM('PENDING', 'CONFIRMED', 'INACTIVE_PENDING_REPLACEMENT', 'FORCE_CONFIRMED');--> statement-breakpoint
CREATE TYPE "public"."decision_method" AS ENUM('NORMAL', 'EXTRA_TIME', 'PENALTIES');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('AWAITING_PAYMENT', 'CONFIRMED', 'RESERVE', 'GROUPED', 'ACTIVE', 'INACTIVE_PENDING_REPLACEMENT', 'WITHDRAWN', 'KICKED', 'DISQUALIFIED', 'ELIMINATED', 'WINNER');--> statement-breakpoint
CREATE TYPE "public"."fixture_status" AS ENUM('SCHEDULED', 'READY', 'WAITING_FOR_SUBMISSIONS', 'WAITING_FOR_OPPONENT', 'RESULT_CONFLICT', 'EVIDENCE_REQUESTED', 'OVERDUE', 'RESOLVED', 'FORFEIT', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."graphic_type" AS ENUM('GROUP_FIXTURES', 'GROUP_STANDINGS', 'KNOCKOUT_BRACKET', 'WINNER_ANNOUNCEMENT');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('PREMIUM_CUTOFF', 'PAYMENT_DEADLINE', 'SIGNUP_CLOSE', 'GROUP_PUBLISH', 'GROUP_CONFIRMATION_REMINDER', 'GROUP_CONFIRMATION_DEADLINE', 'FIXTURE_READY', 'RESULT_FIRST_REMINDER', 'RESULT_STAFF_ALERT', 'PRIZE_DETAILS_DEADLINE', 'MIDNIGHT_CLEANUP');--> statement-breakpoint
CREATE TYPE "public"."knockout_round_status" AS ENUM('PENDING', 'ACTIVE', 'COMPLETED', 'PAUSED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('PAYPAL', 'REVOLUT');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'REFUND_DUE', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED', 'PRIZE_PENDING', 'PRIZE_PAID');--> statement-breakpoint
CREATE TYPE "public"."resolution_source" AS ENUM('DUAL_SUBMISSION', 'STAFF_OVERRIDE', 'FORFEIT_HOME', 'FORFEIT_AWAY', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('GROUP', 'ROUND_OF_64', 'ROUND_OF_32', 'ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL');--> statement-breakpoint
CREATE TYPE "public"."tournament_status" AS ENUM('DRAFT', 'PUBLISHED', 'PREMIUM_SIGNUP', 'GENERAL_SIGNUP', 'PAYMENT_LOCKED', 'SIGNUP_CLOSED', 'GENERATING_GROUPS', 'GROUP_CONFIRMATION', 'GROUP_STAGE_LIVE', 'CALCULATING_QUALIFIERS', 'QUALIFICATION_REVIEW', 'KNOCKOUT_LIVE', 'FINAL_LIVE', 'COMPLETED', 'CANCELLED', 'CLEANING_UP', 'CLEANED');--> statement-breakpoint
CREATE TABLE "guild_configs" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"admin_role_ids" text[] DEFAULT '{}' NOT NULL,
	"premium_role_id" text,
	"participant_role_id" text,
	"group_category_id" text,
	"knockout_category_id" text,
	"staff_category_id" text,
	"audit_log_channel_id" text,
	"rules_channel_id" text,
	"tournament_channels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"branding_primary_color" text DEFAULT '#0B1F3A' NOT NULL,
	"branding_accent_color" text DEFAULT '#FFC93C' NOT NULL,
	"default_entry_fee_pence" integer DEFAULT 1500 NOT NULL,
	"prize_calculation_mode" text DEFAULT 'CONFIRMED_TEAMS_TIMES_FEE' NOT NULL,
	"prize_calculation_value_pence" integer,
	"prize_calculation_value_percent" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"weekday" text,
	"channel_id" text,
	"schedule" jsonb NOT NULL,
	"entry_fee_pence" integer DEFAULT 1500 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"template_id" uuid,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"status" "tournament_status" DEFAULT 'DRAFT' NOT NULL,
	"phase" text,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_reason" text,
	"announcement_channel_id" text,
	"announcement_message_id" text,
	"entry_fee_pence" integer NOT NULL,
	"prize_configuration" jsonb NOT NULL,
	"schedule" jsonb NOT NULL,
	"winner_entry_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"display_name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"active_ban" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"active_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"group_code" text NOT NULL,
	"role_id" text,
	"chat_channel_id" text,
	"results_channel_id" text,
	"staff_channel_id" text,
	"graphic_message_id" text,
	"confirmation_message_id" text,
	"results_panel_message_id" text,
	"qualification_slots" integer DEFAULT 2 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knockout_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"stage" "stage" NOT NULL,
	"round_index" integer NOT NULL,
	"status" "knockout_round_status" DEFAULT 'PENDING' NOT NULL,
	"chat_channel_id" text,
	"results_channel_id" text,
	"staff_channel_id" text,
	"role_id" text,
	"graphic_message_id" text,
	"results_panel_message_id" text,
	"draw_metadata" jsonb,
	"published_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"manager_user_id" text NOT NULL,
	"co_manager_user_id" text,
	"premium_at_signup" boolean DEFAULT false NOT NULL,
	"signup_time" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_status" "payment_status" DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	"payment_confirmed_by" text,
	"payment_confirmed_at" timestamp with time zone,
	"late_payment_override" boolean DEFAULT false NOT NULL,
	"late_payment_override_by" text,
	"rules_version_id" uuid NOT NULL,
	"rules_accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_status" "entry_status" DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	"reserve_position" integer,
	"group_id" uuid,
	"confirmation_status" "confirmation_status" DEFAULT 'PENDING' NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"kicked_at" timestamp with time zone,
	"kick_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_memberships" (
	"group_id" uuid NOT NULL,
	"tournament_entry_id" uuid NOT NULL,
	"slot_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_memberships_group_id_tournament_entry_id_pk" PRIMARY KEY("group_id","tournament_entry_id")
);
--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"group_id" uuid,
	"knockout_round_id" uuid,
	"stage" "stage" NOT NULL,
	"round_number" integer NOT NULL,
	"home_entry_id" uuid NOT NULL,
	"away_entry_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"status" "fixture_status" DEFAULT 'SCHEDULED' NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"decision_method" "decision_method",
	"penalty_home" integer,
	"penalty_away" integer,
	"winner_entry_id" uuid,
	"resolution_source" "resolution_source",
	"resolved_at" timestamp with time zone,
	"first_reminder_sent_at" timestamp with time zone,
	"staff_alert_sent_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fixture_id" uuid NOT NULL,
	"submitting_entry_id" uuid NOT NULL,
	"submitting_user_id" text NOT NULL,
	"canonical_home_score" integer NOT NULL,
	"canonical_away_score" integer NOT NULL,
	"decision_method" "decision_method",
	"penalty_home" integer,
	"penalty_away" integer,
	"declared_winner_entry_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text,
	"club_id" uuid,
	"reason" text NOT NULL,
	"issued_by" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_entry_id" uuid NOT NULL,
	"status" "payment_status" NOT NULL,
	"amount_pence" integer NOT NULL,
	"method" "payment_method",
	"staff_note" text,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_nickname_snapshots" (
	"tournament_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"original_nickname" text,
	"tournament_nickname" text NOT NULL,
	"restored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_nickname_snapshots_tournament_id_user_id_pk" PRIMARY KEY("tournament_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid,
	"job_type" "job_type" NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"tournament_id" text,
	"actor_type" "actor_type" NOT NULL,
	"actor_discord_id" text,
	"action" text NOT NULL,
	"target_entity_type" text NOT NULL,
	"target_entity_id" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" text NOT NULL,
	"interaction_id" text
);
--> statement-breakpoint
CREATE TABLE "graphics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tournament_id" uuid NOT NULL,
	"group_id" uuid,
	"knockout_round_id" uuid,
	"graphic_type" "graphic_type" NOT NULL,
	"content_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"file_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournament_templates" ADD CONSTRAINT "tournament_templates_guild_id_guild_configs_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_configs"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_guild_id_guild_configs_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_configs"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_template_id_tournament_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."tournament_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_guild_id_guild_configs_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_configs"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules_versions" ADD CONSTRAINT "rules_versions_guild_id_guild_configs_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_configs"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knockout_rounds" ADD CONSTRAINT "knockout_rounds_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_rules_version_id_rules_versions_id_fk" FOREIGN KEY ("rules_version_id") REFERENCES "public"."rules_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_tournament_entry_id_tournament_entries_id_fk" FOREIGN KEY ("tournament_entry_id") REFERENCES "public"."tournament_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_knockout_round_id_knockout_rounds_id_fk" FOREIGN KEY ("knockout_round_id") REFERENCES "public"."knockout_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_entry_id_tournament_entries_id_fk" FOREIGN KEY ("home_entry_id") REFERENCES "public"."tournament_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_entry_id_tournament_entries_id_fk" FOREIGN KEY ("away_entry_id") REFERENCES "public"."tournament_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_winner_entry_id_tournament_entries_id_fk" FOREIGN KEY ("winner_entry_id") REFERENCES "public"."tournament_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_submissions" ADD CONSTRAINT "result_submissions_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_submissions" ADD CONSTRAINT "result_submissions_submitting_entry_id_tournament_entries_id_fk" FOREIGN KEY ("submitting_entry_id") REFERENCES "public"."tournament_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_submissions" ADD CONSTRAINT "result_submissions_declared_winner_entry_id_tournament_entries_id_fk" FOREIGN KEY ("declared_winner_entry_id") REFERENCES "public"."tournament_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "bans_guild_id_guild_configs_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_configs"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bans" ADD CONSTRAINT "bans_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tournament_entry_id_tournament_entries_id_fk" FOREIGN KEY ("tournament_entry_id") REFERENCES "public"."tournament_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_nickname_snapshots" ADD CONSTRAINT "member_nickname_snapshots_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphics" ADD CONSTRAINT "graphics_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphics" ADD CONSTRAINT "graphics_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphics" ADD CONSTRAINT "graphics_knockout_round_id_knockout_rounds_id_fk" FOREIGN KEY ("knockout_round_id") REFERENCES "public"."knockout_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_guild_normalised_name_idx" ON "clubs" USING btree ("guild_id","normalised_name");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_tournament_code_idx" ON "groups" USING btree ("tournament_id","group_code");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_tournament_club_idx" ON "tournament_entries" USING btree ("tournament_id","club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_memberships_slot_idx" ON "group_memberships" USING btree ("group_id","slot_number");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_jobs_idempotency_key_idx" ON "scheduled_jobs" USING btree ("idempotency_key");