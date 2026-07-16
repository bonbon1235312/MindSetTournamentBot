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
    client.ts, intents.ts   discord.js Client, minimal (unprivileged) intent set
    commands/                /setup, /tournament, /payments slash commands
    components/              Button/modal/select handlers (signup flow, announcement actions)
    embeds/                  Embed builders
    interactions/            router.ts dispatches every interaction; custom-id.ts encodes/decodes state
    permissions/              Staff role checks
  database/
    schema/                  Drizzle schema — 17 tables (see below)
    migrations/              Generated SQL migrations, committed to the repo
    repositories/            Typed data-access functions per entity
    transactions/            Optimistic-lock helper for concurrent staff actions
  domain/                    Pure, framework-free business logic (see below) — this is
                              the layer with the heaviest test coverage, deliberately
                              kept free of Discord/DB imports so it's trivial to unit-test
  services/                  Orchestration that calls domain + repositories + Discord API
  graphics/
    svg/                     escape.ts (XSS-safe text), base.ts (shared brand chrome)
    templates/                Pure functions: input data -> SVG string
    renderers/                SVG string -> cached PNG via Sharp
  workers/                   Scheduler job handlers (see "Known gaps" below)
  types/                     AppContext, typed AppError hierarchy
  utils/                     logger.ts (Pino), seeded-random.ts (audit-reproducible shuffles)

tests/
  unit/                      Pure domain logic — no I/O, no DB, no Discord
  integration/                Anything touching the filesystem or a real service (graphics render pipeline)

scripts/
  migrate.ts                  Applies migrations to DATABASE_URL
  deploy-commands.ts          Registers slash commands (guild or global)
```

## Database schema (17 tables, all live in the configured Postgres instance)

`guild_configs`, `tournament_templates`, `tournaments`, `clubs`,
`tournament_entries`, `member_nickname_snapshots`, `groups`,
`group_memberships`, `fixtures`, `result_submissions`, `knockout_rounds`,
`bans`, `payments`, `rules_versions`, `scheduled_jobs`, `audit_events`,
`graphics`.

Every timed/state-changing table carries a `version` column for optimistic
concurrency (section 26/37) and the tables that need it carry
`created_at`/`updated_at`. `scheduled_jobs` is the persistent job queue —
see the scheduler section below.

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

## Known gaps (honest, not glossed over)

These are real, verified-missing pieces, not places where something was
half-built and might silently misbehave — each one below either doesn't
exist yet or exists as infrastructure with nothing wired into it:

1. **No job handlers are registered.** `SchedulerService.start()` runs, but
   `registerHandler()` is never called anywhere in `bootstrap.ts`. Any job
   enqueued today (`PREMIUM_CUTOFF`, `PAYMENT_DEADLINE`, `GROUP_PUBLISH`,
   `MIDNIGHT_CLEANUP`, etc.) will fail immediately with "No handler
   registered" and dead-letter after retries. This is the single highest-
   priority gap — it means the tournament clock doesn't actually do
   anything yet.
2. **Several repositories don't exist**: `groups`, `group-memberships`,
   `fixtures`, `result-submissions`, `knockout-rounds`, `payments`, and
   `graphics` have no repository layer, even though their schema tables
   exist. Anything touching group/knockout/result/payment persistence needs
   this written first.
3. **No Discord resource creation for groups or knockouts.** Section 12/23's
   per-group/per-stage roles, `chat`/`results`/`staff` channels, and
   permission overwrites are not implemented. `services/` has no
   `discord-resource-service.ts` yet.
4. **No result-submission UI.** The `Submit Result` button, fixture
   selection menu, and score modal (section 18/24) don't exist.
5. **No knockout bracket graphic.** Group fixtures/standings are done;
   `KNOCKOUT_BRACKET` and `WINNER_ANNOUNCEMENT` graphic types are defined in
   the schema enum but have no template/renderer.
6. **No midnight cleanup or repair system** (sections 33/34).
7. **No evidence/dispute system** (section 28).
8. **Staff override controls beyond the payment panel** (section 26/27) —
   group/knockout staff actions (void fixture, forfeit, disqualify, force
   progression, etc.) are not built.

None of the above is faked, stubbed with a `TODO`, or backed by in-memory
state pretending to be real — they simply don't exist in the codebase yet.
Building them is the direct continuation of this plan, roughly in the order
listed (job handlers unblock the live tournament clock; the rest follows).
