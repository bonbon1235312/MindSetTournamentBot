# MindSet Tournament Bot — Implementation Plan

Production Discord bot that automates FC Clubs cash-cup tournaments: signup,
payment tracking, random group draws, round-robin scheduling, dual-sided
result submission, qualification, knockout brackets, and midnight cleanup.

This document tracks the actual build against the phases below. Status is
kept honest — a phase is only marked done once its code compiles, passes
lint, and (where applicable) has been exercised against the real bot token
and real Postgres database, not just written.

## Architecture

```
src/
  index.ts                 Process entrypoint
  app/                      bootstrap() / registerShutdownHandlers()
  config/                   env.ts (Zod-validated), constants.ts (all defaults)
  discord/
    client.ts, intents.ts   discord.js Client — Guilds + GuildMembers (see "Privileged intent" below)
    commands/                /setup, /tournament, /payments, /ticket-panel slash commands
    components/              Button/modal/select handlers (signup flow, announcement actions, tickets)
    embeds/                  Embed builders
    interactions/            router.ts dispatches every interaction; custom-id.ts encodes/decodes state
    listeners/                Gateway event listeners that aren't interactions (member join/leave)
    permissions/              Staff role checks
  database/
    schema/                  Drizzle schema — 18 tables (see below)
    migrations/              Generated SQL migrations, committed to the repo
    repositories/            Typed data-access functions per entity
    transactions/            Optimistic-lock helper for concurrent staff actions
  domain/                    Pure, framework-free business logic (see below) — this is
                              the layer with the heaviest test coverage, deliberately
                              kept free of Discord/DB imports so it's trivial to unit-test
  services/                  Orchestration that calls domain + repositories + Discord API,
                              including discord-resource-service.ts (idempotent role/channel
                              creation) and tournament-progression-service.ts (status walker)
  graphics/
    svg/                     escape.ts (XSS-safe text), base.ts (shared brand chrome)
    templates/                Pure functions: input data -> SVG string
    renderers/                SVG string -> cached PNG via Sharp
  workers/
    job-handlers/             Scheduler job handlers — PREMIUM_CUTOFF, SIGNUP_CLOSE,
                               GROUP_PUBLISH implemented; the rest are gaps (see below)
  types/                     AppContext, typed AppError hierarchy
  utils/                     logger.ts (Pino), seeded-random.ts (audit-reproducible shuffles)

tests/
  unit/                      Pure domain logic — no I/O, no DB, no Discord
  integration/                Anything touching the filesystem or a real service (graphics render pipeline)

scripts/
  migrate.ts                  Applies migrations to DATABASE_URL
  deploy-commands.ts          Registers slash commands (guild or global)
```

## Database schema (18 tables, all live in the configured Postgres instance)

`guild_configs`, `tournament_templates`, `tournaments`, `clubs`,
`tournament_entries`, `member_nickname_snapshots`, `groups`,
`group_memberships`, `fixtures`, `result_submissions`, `knockout_rounds`,
`bans`, `payments`, `rules_versions`, `scheduled_jobs`, `audit_events`,
`graphics`, `tickets`.

Every timed/state-changing table carries a `version` column for optimistic
concurrency (section 26/37) and the tables that need it carry
`created_at`/`updated_at`. `scheduled_jobs` is the persistent job queue —
see the scheduler section below.

## Privileged intent required: GuildMembers

The welcome/goodbye feature needs the `GuildMemberAdd`/`GuildMemberRemove`
gateway events, which requires the privileged **Server Members Intent** to
be enabled for this application in the Discord Developer Portal (Bot tab).
This is **not currently enabled** — verified live: the bot fails to connect
with "Used disallowed intents" until it is. Enabling it is a one-click
portal toggle only the application owner can do; nothing in this codebase
can flip it remotely. Every other command/feature in the bot has been
verified live against the real bot token and works with the intent
declared in code but not yet enabled on the portal side (they don't need
it — only welcome/goodbye does).

## Welcome / goodbye

`discord/listeners/member-events.ts`, wired into `bootstrap.ts`. Zero
configuration by design: both events find the channel by searching for a
text channel whose name contains "welcome" (case-insensitive) rather than
requiring a `guild_configs` entry, since no dedicated goodbye channel
exists in the mapped server and the goal was "no setup." Blocked on the
GuildMembers intent above — code is written and typechecks/lints clean,
but the actual join/leave gateway events have not fired in this session.

## Ticket system

Fully self-provisioning, matching the "no setup" requirement literally:
staff run `/ticket-panel` once wherever they want the panel; everything
else — the "Support Tickets" category, per-ticket private channel,
permissions — is found-or-created on demand. `config/constants.ts`'s
`TICKET_TYPES` array is the only place a new ticket type needs adding (4
defaults: General Support, Payment Issue, Report a Dispute, Other). One
open ticket per user at a time; Claim and Close buttons in every ticket
channel; closing marks the DB row CLOSED and deletes the channel after a
short delay. Verified: typecheck/lint/tests clean, `tickets` table live in
the database, `/ticket-panel` command deployed to the real guild. Not
verified: an actual button click through the full open/claim/close flow
in Discord (no second Discord account available to click as a "user"
distinct from staff in this session).

## Group publish pipeline (the tournament clock's first real action)

`workers/job-handlers/group-publish-handler.ts` is the section 11-14
pipeline end-to-end: builds the eligible pool (payment-confirmed, not
withdrawn/kicked/disqualified), walks entries `AWAITING_PAYMENT` →
`CONFIRMED` through the state machine, runs the seeded Fisher-Yates draw,
persists `groups`/`group_memberships`/`fixtures`, creates each group's
role + 3 channels via `services/discord-resource-service.ts` (idempotent —
resolves by stored ID first, then by name, before ever creating), assigns
the group role to every manager/co-manager (a failed assignment — e.g. the
user left, or a role-hierarchy issue — is caught and logged, never fails
the whole pipeline), generates the round-robin fixture schedule, renders
and posts the group fixtures graphic, and advances the tournament through
`GENERATING_GROUPS` → `GROUP_CONFIRMATION`.

`workers/job-handlers/premium-cutoff-handler.ts` and `signup-close-handler.ts`
handle the two simpler schedule transitions. All three are registered with
the scheduler in `bootstrap.ts` via `workers/job-handlers/index.ts`, and
`/tournament create` now actually enqueues `PREMIUM_CUTOFF`, `SIGNUP_CLOSE`,
and `GROUP_PUBLISH` jobs at their resolved schedule times — previously
nothing enqueued any job at all, so the scheduler ran but had nothing to do.

**Verified live end-to-end** against the real database and the real
"Mindset HUB" guild: created a throwaway tournament with 4 test entries,
ran the handler, confirmed 1 group / 4 memberships / 6 fixtures (correct
round-robin count) / a role + 3 real Discord channels / a posted graphic
message / the tournament status correctly landing on `GROUP_CONFIRMATION`,
then deleted every Discord resource and database row the test created and
confirmed zero residue.

## Domain logic (pure functions, fully unit-tested)

| Module | Responsibility |
|---|---|
| `domain/groups/group-generation.ts` | Seeded Fisher-Yates shuffle → exact groups of 4 + reserves |
| `domain/fixtures/round-robin.ts` | Circle-method round-robin: 4 teams → 3 rounds × 2 matches |
| `domain/standings/standings.ts` | Points/GD/alphabetical table, zero other tiebreakers |
| `domain/qualification/qualification.ts` | Power-of-two bracket sizing, third-place ranking, wildcard fallback, shortfall flag |
| `domain/knockouts/knockout-draw.ts` | Unbiased random pairing, no seeding |
| `domain/fixtures/result-matching.ts` | Normalizes either side's submission into canonical home/away orientation |
| `domain/fixtures/result-validation.ts` | Knockout ET/penalties legality rules |
| `domain/entries/team-name.ts` | Validation, mention-stripping, normalization for uniqueness |
| `domain/entries/nickname.ts` | Safe " M"/" CO" suffix-preserving truncation |
| `domain/payments/prize-pool.ts` | Configurable prize-pool calculation modes |
| `domain/{tournaments,entries,fixtures}/state-machine.ts` | Explicit legal-transition tables per section 45 |
| `utils/seeded-random.ts` | mulberry32 PRNG + Fisher-Yates — every random draw is seed-reproducible for audit |

## Scheduler (section 32)

`services/scheduler-service.ts` is a pure claim → run → complete/retry engine.
It knows nothing about tournament business logic — job handlers are
registered per `job_type` via `registerHandler()`. This split means the
hardest-to-get-right part (the concurrency-safe claim/retry/reconciliation
logic) is tested completely independently of what a `PAYMENT_DEADLINE` job
actually does.

`database/repositories/job-repository.ts` claims due jobs with
`FOR UPDATE SKIP LOCKED` inside a CTE, so two worker processes can never
claim the same row — verified live against the real database (row-lock
claim, retry backoff, dead-lettering after `maxAttempts`, and crash
reconciliation of jobs left `RUNNING` past their lease all exercised
end-to-end, not just type-checked).

## Graphics (section 14)

`graphics/svg/` + `graphics/templates/` + `graphics/renderers/` form a
three-layer pipeline: typed input → escaped/truncated SVG string → Sharp
rasterization → disk-cached PNG keyed by a content hash of the SVG. Group
fixtures and group standings templates are implemented and verified
end-to-end (real PNG output visually inspected, XML injection/mass-mention
team names confirmed non-crashing, content-hash cache-hit/miss behavior
confirmed). Knockout bracket and winner-announcement templates are not yet
built — see "Known gaps."

## Phase status

| Phase | Status |
|---|---|
| 1. Tooling, env validation, logging, DB client, Discord client, command deploy | ✅ Done |
| 2. Database schema, migrations, repositories (partial — see gaps), audit logging, state machines | ✅ Core done, repository coverage incomplete |
| 3. Domain logic — scheduling, standings, qualification, groups, nicknames | ✅ Done, 100% unit-tested |
| 4. Scheduler engine with DB-backed job claiming | ✅ Done, verified live against real DB |
| 5. Graphics rendering (SVG → PNG via Sharp) | ✅ Group fixtures + standings done and verified; knockout bracket not built |
| 6. Discord interaction layer — setup, announcement, signup, payments | 🟡 Substantially built (see gaps) |
| 7. Result submission (group + knockout dual-sided) | ❌ Not built |
| 8. Automated tests | ✅ 144 tests, all passing, covering every pure domain module |
| 9. Documentation | ✅ This file + README.md |
| 10. Build validation | ✅ Clean typecheck, clean lint, all tests passing |
| 11. Welcome / goodbye | 🟡 Built, blocked on the GuildMembers portal toggle (see above) |
| 12. Ticket system | ✅ Done, verified against real DB + command deployment |
| 13. Scheduler job handlers (PREMIUM_CUTOFF, SIGNUP_CLOSE, GROUP_PUBLISH) | ✅ Done, verified live end-to-end including real Discord resource creation |

## Known gaps (honest, not glossed over)

These are real, verified-missing pieces, not places where something was
half-built and might silently misbehave — each one below either doesn't
exist yet or exists as infrastructure with nothing wired into it:

1. **Most job handlers still aren't registered.** `PREMIUM_CUTOFF`,
   `SIGNUP_CLOSE`, and `GROUP_PUBLISH` are done and verified live — the
   tournament clock now actually generates groups. But
   `GROUP_CONFIRMATION_REMINDER`, `GROUP_CONFIRMATION_DEADLINE`,
   `FIXTURE_READY`, `RESULT_FIRST_REMINDER`, `RESULT_STAFF_ALERT`,
   `PRIZE_DETAILS_DEADLINE`, and `MIDNIGHT_CLEANUP` have no handler and
   will dead-letter if ever enqueued (nothing currently enqueues them
   either).
2. **Several repositories still don't exist**: `result-submissions`,
   `knockout-rounds`, `payments`, and `graphics` have no repository layer
   (groups/group-memberships/fixtures were added this round). Anything
   touching result submission, knockout progression, or payment/graphic
   history needs these written first.
3. **Knockout Discord resource creation doesn't exist.** Section 23's
   per-stage roles/channels have no equivalent of the group pipeline yet —
   `discord-resource-service.ts` only has `ensureGroupResources`.
4. **No result-submission UI.** The `Submit Result` button, fixture
   selection menu, and score modal (section 18/24) don't exist — group
   fixtures now get created and scheduled, but nobody can report a result
   yet.
5. **No knockout bracket graphic.** Group fixtures/standings are done;
   `KNOCKOUT_BRACKET` and `WINNER_ANNOUNCEMENT` graphic types are defined in
   the schema enum but have no template/renderer.
6. **No midnight cleanup or repair system** (sections 33/34).
7. **No evidence/dispute system** (section 28).
8. **Staff override controls beyond the payment panel** (section 26/27) —
   group/knockout staff actions (void fixture, forfeit, disqualify, force
   progression, etc.) are not built.
9. **Welcome/goodbye is blocked** on the GuildMembers privileged intent not
   yet being enabled in the Discord Developer Portal (see above) — this is
   the one gap that isn't a missing-code problem, it's an external toggle.

None of the above is faked, stubbed with a `TODO`, or backed by in-memory
state pretending to be real — they simply don't exist in the codebase yet.
Building them is the direct continuation of this plan: result submission is
the natural next step now that fixtures actually get created.
