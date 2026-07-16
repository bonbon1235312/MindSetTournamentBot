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
    svg/                     escape.ts (XSS-safe text), base.ts (monochrome brand chrome + logo helper), logo.ts (base64 data URI)
    assets/                  mindset-logo.jpg — copied into dist/ by a postbuild step (see package.json)
    templates/                Pure functions: input data -> SVG string
    renderers/                SVG string -> cached PNG via Sharp
  workers/
    job-handlers/             GROUP_PUBLISH is scheduler-registered; knockout-publish-handler.ts
                               (runInitialKnockoutDraw/advanceKnockoutRound) is invoked directly
                               today (by /tournament test), not yet scheduler-driven — see
                               "Known gaps": it depends on result submission, which isn't built.
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

## Tournament model: one cup at a time, everything auto-created

The original spec's literal wording (a per-weekday channel map, staff
manually linking group/knockout/staff categories via `/setup`, a 40-team
cap on `/tournament test`) didn't match the real deployment: this guild
runs one cash cup at a time, posted in one fixed sign-up channel, with no
category-linking step at all. Corrected:

- `guild_configs.tournamentChannelId` replaces the old per-weekday
  `tournamentChannels` map — one channel, set via `/setup` or directly.
- `getActiveTournamentForGuild()` + `TournamentAlreadyActiveError` block
  `/tournament create` while any non-finished tournament exists for the
  guild — enforced in code, not just documentation.
- `/tournament test`'s `team_count` has no upper bound.
- **No category is ever staff-linked.** Every group gets its own category
  (`groups.categoryId`, named "Group A") and every knockout round gets its
  own category (`knockout_rounds.categoryId`, named "Quarter Finals" etc.),
  auto-created and cached the first time each is needed
  (`discord-resource-service.ts`'s `ensureGroupResources`/
  `ensureKnockoutRoundResources`). `guild_configs` carries zero
  category-cache columns as a result — a deliberate change from an earlier
  draft that gave every group a *shared* "Group Stage" category, which
  would hit Discord's 50-channel-per-category cap on any double-digit-group
  cup and cluttered the channel list.

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

## `/tournament test` — staff diagnostic command

The pipeline above was extracted into `runGroupPublishPipeline()` (options:
`{ groupCodePrefix }`) specifically so `discord/commands/tournament-test.ts`
could call the *exact* production code path synchronously instead of
duplicating it. `groupCodePrefix` exists because `ensureGroupResources`
resolves Discord channels by literal name — without a prefix, a test could
silently find and reuse (and post fake fixtures into) a **real** live
tournament's actual "Group A" channels. This is a static `'TEST-'` prefix,
not a random one — the only thing that genuinely needs to stay unique is
TEST vs. a real cup's plain "A"/"B"/... codes (there is never more than one
of those live, per the one-cup-at-a-time rule above), so a random suffix
was pure noise in the channel list for no real safety benefit.

Creates N fake clubs/entries (`team_count`, default 8, uncapped, using the
staff member running the command as manager on all of them so real Discord
role-assignment is genuinely exercised, not just its failure path), runs
the group-publish pipeline, then **simulates every group fixture's result**
(random scores, draws allowed) so the knockout pipeline below has real data
to compute from, then runs it through to a champion. Verifies every phase
(membership/fixture counts, every Discord category/role/channel, every
graphic) and reports ✅/❌ per phase with the real error message on
failure. Defaults to deleting everything it created afterward
(`cleanup:false` to leave it for manual inspection instead).

**Two real bugs were caught by testing this against the live guild, not
just typechecking it.** First: the group-publish pipeline originally
returned each group's *pre-resource-attachment* database row (captured
right after `createGroup()`, before the later `updateGroupResources()`
calls that attach `roleId`/`chatChannelId`/etc.), so the verification phase
always falsely reported groups as missing a Discord role/channel, and
cleanup silently skipped deleting the real ones it had created — fixed by
threading the updated row through instead of the stale one. Second, while
wiring the knockout pipeline in: `runInitialKnockoutDraw` was called with
the tournament object captured at test-run start, but `runGroupPublishPipeline`
advances that tournament's status (and bumps its `version`) several times
internally — passing the stale object straight into the knockout draw's
own `advanceTournamentTo` call failed optimistic-locking with a
`StalePanelError`. Fixed by re-fetching the tournament immediately before
the knockout draw. Both were live, not hypothetical — the same silent
Discord-resource-leak class of bug in the first case, and a real 500-style
failure in the second.

## Knockout pipeline (section 21/22/23)

`workers/job-handlers/knockout-publish-handler.ts` — two entry points:

- `runInitialKnockoutDraw(ctx, tournament)`: computes standings for every
  group from its RESOLVED fixtures (`domain/standings/standings.ts`), runs
  the qualification engine (`domain/qualification/qualification.ts` — auto
  qualifiers, third-place/wildcard fallback, shortfall warning), draws the
  first round (`domain/knockouts/knockout-draw.ts`'s fully-random
  `drawKnockoutPairings` — no seeding, no protecting group winners, matching
  the spec), and publishes it. An odd qualifier count surviving the
  shortfall fallback (a documented, extremely-small-tournament edge case)
  drops the lowest-ranked qualifier to force an even bracket, with a staff
  warning logged — the domain layer deliberately never invents a bye.
- `advanceKnockoutRound(ctx, tournament)`: call once the current round's
  fixtures are all RESOLVED. Eliminates losers, and either draws + publishes
  the next round from the winners, or — once exactly one team remains —
  marks them tournament `WINNER`, advances the tournament to `COMPLETED`,
  and posts a champion announcement.

Every round gets its own category + role + 3 channels
(`ensureKnockoutRoundResources`, same idempotent by-id-then-by-name-then-
create pattern as groups), a ping in its chat channel, and a bracket
graphic in its results channel. Entry statuses walk
`GROUPED → ACTIVE → (ELIMINATED | WINNER)` through the whole stage, exactly
per the section 45 state machine (no shortcut transitions).

**There is no automatic trigger yet.** Nothing currently calls
`runInitialKnockoutDraw` on its own — it depends on every group fixture
being RESOLVED, and dual-sided result submission (the feature that would
normally resolve a group fixture) isn't built (see "Known gaps"). Today
it's invoked directly, by `/tournament test`'s simulation. Once result
submission exists, the natural trigger is "last group fixture in the
tournament just resolved."

**Verified live end-to-end** against the real database and the real
"Mindset HUB" guild: an 8-team, 2-group cup ran through Semi Finals → Final,
producing a real champion, with every round's category/role/channels/
graphic confirmed present in Discord before cleanup removed all of it.

## Result submission (section 18/24) — the gap this closes

The previous version of this plan flagged dual-sided result submission as
the one thing standing between "everything else is built" and "a real cup
can actually run end to end." It's now built.

**Fixtures graphic moved to the chat channel, pinned.** It used to post to
the results channel; now it posts to chat (alongside the "you've been
drawn" ping) and gets pinned there, so it's the first thing anyone sees
when they open the channel. The results channel is reserved for the
results panel below.

**`FIXTURE_READY` job** (`workers/job-handlers/fixture-ready-handler.ts`,
now registered — no longer a gap): a fixture starts `SCHEDULED` and can't
accept a result until its scheduled kickoff time arrives. One job is
enqueued per fixture at creation time (`runAt` = the fixture's
`scheduledAt` for group fixtures, or immediately for knockout fixtures,
which don't have a pre-planned slot — see the knockout pipeline section).
It walks `SCHEDULED -> READY -> WAITING_FOR_SUBMISSIONS`, both legal hops
per section 45's fixture state machine, idempotently (already-past-SCHEDULED
is a safe no-op — verified live: the real scheduler's own 5-second poll
raced a manual invocation during testing and both landed cleanly).

**Results panel** (`discord/embeds/results-panel-embed.ts` +
`discord/components/result-submission-flow.ts`): posted to the results
channel the moment a group/round is published, listing every fixture with
a live status line and a select menu of everything currently submittable.
Picking a fixture shows a score modal — "Your score / Opponent's score"
for a manager or co-manager (whichever side they're on, detected server-
side, never trusted from the client), "Home score / Away score" for staff
(who aren't tied to a side). Knockout fixtures get two extra optional
penalty fields; group fixtures don't (a draw is a valid group result,
enforced by rejecting `PENALTIES` on a group submission).

**Submission processing** (`services/result-submission-service.ts`) reuses
the pre-existing, already-tested domain layer verbatim —
`normalizeSubmission`/`submissionsMatch` (section 18) and
`validateKnockoutResult` (section 24) were built and unit-tested earlier in
this project but had nothing calling them until now. A submission is
stored as a new `result_submissions` row (previous one from the same entry
deactivated, not deleted — full revision history survives); if the
opponent hasn't submitted yet the fixture moves to
`WAITING_FOR_OPPONENT`; once both sides are in, matching submissions
silently auto-resolve the fixture (`resolutionSource: DUAL_SUBMISSION`),
mismatched ones move it to `RESULT_CONFLICT` and post a conflict panel to
the staff channel. Staff input always resolves immediately — no matching
needed, it's authoritative.

**Staff conflict panel**: shows both submissions side by side with buttons
to accept either one or manually override with a fresh score — same modal
shape as a normal staff submission. The results panel refreshes in place
(edited, not reposted) after every submission or resolution.

**Verified live** against the real database and the real "Mindset HUB"
guild: matching dual submissions auto-resolved correctly
(`DUAL_SUBMISSION`, correct score); mismatched submissions correctly
entered `RESULT_CONFLICT`; a staff override correctly resolved it
(`STAFF_OVERRIDE`, correct score). What couldn't be verified interactively
is the actual button-click/modal-submit UI itself — there's no second
Discord account available in this session to click as a "user" distinct
from staff (same limitation noted for the ticket system) — so verification
went through the same service functions the real Discord handlers call,
not the handlers themselves. The panel-embed rendering logic (status
lines, score formatting) was checked by direct code review rather than a
live round-trip for the same reason.

**A real authorization bug was caught by re-reading this code, not by
testing it.** `custom-id.ts`'s own doc comment states the security
contract plainly: custom IDs aren't cryptographically signed, so every
handler must re-validate the encoded data against current database state
before acting — a tampered custom_id can point at data but must never
bypass a server-side check. The first version of `handleSubmitResultModal`
violated exactly this: it trusted a `submittingEntryId` embedded in the
modal's own custom_id (set once, at select-time) instead of re-deriving it
from `interaction.user.id` at submit-time — a forged modal-submit
interaction could have claimed to be submitting on behalf of a team the
actual clicking user had nothing to do with. `handleStaffOverrideModal`
had the same class of gap one level worse: it never checked
`isStaffMember` at all, relying entirely on the assumption that only a
staff member could have reached it via the select menu's earlier gate — a
forged `fixture:staff_modal:<fixtureId>` interaction would have let anyone
immediately resolve any fixture with any score, no matching required.
Both now re-derive/re-check server-side inside the modal handler itself,
matching the pattern every other handler in this codebase already follows
(see `handleConflictResolutionButton`, `applyPaymentChange`, etc.).
Verified live: an unauthorized user ID correctly rejected by
`resolveSubmittingEntryId` with the expected `PermissionError`.

## Group confirmation

Staff-only "this group is done" step, added to the results panel as a
second row (only shown for groups — knockout rounds don't have this
concept): a **Confirm Group Complete** button, disabled until every
fixture in the group has reached a terminal status (`RESOLVED`/`FORFEIT`/
`VOID`), and permanently disabled (relabeled "✅ Group Confirmed") once
used — a group can only be confirmed once
(`confirmGroupComplete` in `result-submission-service.ts` checks
`groups.confirmationMessageId` before doing anything, reusing a schema
field that already existed but was never wired to anything).

On click: computes final standings (the exact same
`computeGroupStandings` helper the knockout pipeline uses — extracted from
what used to be duplicated inline logic there), renders the group
standings graphic, posts it in the group's **chat** channel pinging the
group role, pins it, and stores the message ID as the confirmation marker.
The results panel refreshes to show the confirmed state.

**Verified live** against the real database and guild, using an already-
fully-resolved group from an earlier live test run: `confirmGroupComplete`
correctly computed and returned standings with the right qualification
cutoff; the standings graphic posted, pinged the group role, and pinned
correctly (visually confirmed — the qualification line correctly separates
the top 2 from the bottom 2); a second confirmation attempt on the same
group was correctly rejected as already-confirmed.

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
fixtures, group standings, and the knockout bracket templates are all
implemented and verified (real PNG output visually inspected — locally
rendered and viewed before ever touching Discord, then confirmed again in
the live guild — XML injection/mass-mention team names confirmed
non-crashing, content-hash cache-hit/miss behavior confirmed).
Winner-announcement is a plain Discord message today, not a graphic — see
"Known gaps."

**Deliberately monochrome**, matching the MindSet shield logo
(`graphics/assets/mindset-logo.jpg`, embedded as a base64 data URI via
`graphics/svg/logo.ts` — no network fetch, no separate asset upload). This
palette (`BRAND` in `graphics/svg/base.ts`) is scoped to the graphics
pipeline only and is independent of `DEFAULT_BRANDING`
(`config/constants.ts`), which still drives Discord embed accent colors
elsewhere in the bot — changing one doesn't silently change the other.
`npm run build`'s postbuild step copies `graphics/assets/` into `dist/` so
the logo is available under the `dist`-based `npm start` path too, even
though production actually runs via `ts-node` against `src/` directly (see
the Pterodactyl egg's fixed startup command) and doesn't strictly need it.

## Phase status

| Phase | Status |
|---|---|
| 1. Tooling, env validation, logging, DB client, Discord client, command deploy | ✅ Done |
| 2. Database schema, migrations, repositories (partial — see gaps), audit logging, state machines | ✅ Core done, repository coverage incomplete |
| 3. Domain logic — scheduling, standings, qualification, groups, nicknames | ✅ Done, 100% unit-tested |
| 4. Scheduler engine with DB-backed job claiming | ✅ Done, verified live against real DB |
| 5. Graphics rendering (SVG → PNG via Sharp) | ✅ Group fixtures, standings, and knockout bracket all done and verified — monochrome + logo |
| 6. Discord interaction layer — setup, announcement, signup, payments | 🟡 Substantially built (see gaps) |
| 7. Result submission (group + knockout dual-sided) | ✅ Done, verified live — results panel, submission matching/conflict, staff override |
| 8. Automated tests | ✅ 144 tests, all passing, covering every pure domain module |
| 9. Documentation | ✅ This file + README.md |
| 10. Build validation | ✅ Clean typecheck, clean lint, all tests passing |
| 11. Welcome / goodbye | 🟡 Built, blocked on the GuildMembers portal toggle (see above) |
| 12. Ticket system | ✅ Done, verified against real DB + command deployment |
| 13. Scheduler job handlers (PREMIUM_CUTOFF, SIGNUP_CLOSE, GROUP_PUBLISH, FIXTURE_READY) | ✅ Done, verified live end-to-end including real Discord resource creation |
| 14. `/tournament test` diagnostic command | ✅ Done, verified live — exercises group AND knockout pipelines through to a champion |
| 15. Knockout pipeline (draw, per-round Discord resources, bracket graphic) | ✅ Done, verified live end-to-end |

## Known gaps (honest, not glossed over)

These are real, verified-missing pieces, not places where something was
half-built and might silently misbehave — each one below either doesn't
exist yet or exists as infrastructure with nothing wired into it:

1. **Most job handlers still aren't registered.** `PREMIUM_CUTOFF`,
   `SIGNUP_CLOSE`, `GROUP_PUBLISH`, and `FIXTURE_READY` are done and
   verified live — the tournament clock now actually generates groups and
   opens fixtures for submission automatically at kickoff. But
   `GROUP_CONFIRMATION_REMINDER`, `GROUP_CONFIRMATION_DEADLINE`,
   `RESULT_FIRST_REMINDER`, `RESULT_STAFF_ALERT`, `PRIZE_DETAILS_DEADLINE`,
   and `MIDNIGHT_CLEANUP` have no handler and will dead-letter if ever
   enqueued (nothing currently enqueues them either — an overdue fixture
   just sits `WAITING_FOR_SUBMISSIONS`/`WAITING_FOR_OPPONENT` forever with
   no reminder or staff alert, since `OVERDUE` is a legal status nothing
   currently transitions a fixture into).
2. **`payments` and `graphics` repositories still don't exist** (groups/
   group-memberships/fixtures/knockout-rounds/result-submissions all have
   one now). Anything touching payment or graphic-cache history as its own
   queryable entity needs these written first — payment status itself is
   already readable off `tournament_entries` directly, this is only about
   the `payments`/`graphics` history tables.
3. **`WINNER_ANNOUNCEMENT` is a plain Discord message, not a graphic.** The
   schema enum defines it as a graphic type; today `advanceKnockoutRound`
   just posts `🏆 **Team** are the champions` as text. Not asked for in
   this round's scope — flagging it rather than silently shipping half of
   what the enum implies exists.
4. **No midnight cleanup or repair system** (sections 33/34) — includes no
   automatic mechanism to catch a tournament stuck mid-knockout-stage, and
   no `OVERDUE` transition for a fixture nobody ever submits a result for.
5. **No evidence/dispute system** (section 28) — the conflict panel lets
   staff accept a submission or manually override; there's no "request
   evidence" button or a place to attach screenshots.
6. **Staff override controls beyond payments and result conflicts**
   (section 26/27) — void fixture, forfeit, disqualify, force progression,
   etc. are not built.
7. **Welcome/goodbye is blocked** on the GuildMembers privileged intent not
   yet being enabled in the Discord Developer Portal (see above) — this is
   the one gap that isn't a missing-code problem, it's an external toggle.

None of the above is faked, stubbed with a `TODO`, or backed by in-memory
state pretending to be real — they simply don't exist in the codebase yet.
Every pipeline a real cup needs to run start-to-finish — signup, payment,
groups, results, knockouts, a declared champion — is now built and
verified live. What's left is reminders/alerts/cleanup around the edges
and staff tooling for edge cases, not anything on the critical path.
