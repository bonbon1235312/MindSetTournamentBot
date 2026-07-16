# MindSet Tournament Bot

A production Discord bot that automates FC Clubs cash-cup tournaments —
signup, manual payment tracking, random group draws, round-robin
scheduling, dual-sided result submission, qualification, and knockout
progression, all driven by buttons, modals, and dropdowns rather than slash
commands for normal users. Also includes a self-provisioning support
ticket system and welcome/goodbye messages.

> **Current status:** every pipeline a real cup needs to run start-to-finish
> is built and verified live — signup, payment tracking, groups, dual-sided
> result submission (with staff conflict resolution), knockout progression,
> and a declared champion. The tournament clock fires automatically:
> signups close, groups get generated, fixtures open for submission at
> kickoff, and once results come in the knockout stage draws and plays
> itself out to a winner — all without staff intervention. What's left
> (reminders, staff alerts, midnight cleanup, an evidence/dispute system)
> is edge-case tooling, not anything on the critical path — see
> [PLAN.md](./PLAN.md#known-gaps) for the exact list. Welcome/goodbye
> messages are built but **blocked**: they need the GuildMembers privileged
> intent enabled in the Discord Developer Portal (Bot tab → Server Members
> Intent) — see below. Only one cash cup runs at a time per server, posted
> to one fixed sign-up channel — see "Creating a tournament" below.

## Feature list

- Polished tournament announcement embed, edited in place as signups/
  payments/state change (never spammed as new messages)
- Button/modal/select-driven signup: team name → co-manager search →
  cash-cup rules acceptance → entry created
- Automatic manager/co-manager nicknaming (`Team Name M` / `Team Name CO`),
  safely shortened to fit Discord's 32-character limit without ever cutting
  off the suffix, with original nicknames snapshotted for restoration
- Staff payment control panel (confirm/reject/refund-track, per-entry)
- Configurable premium-role priority signup window
- Withdrawal / kick / tournament-ban kept as three distinct concepts,
  never conflated
- Seeded, audit-reproducible random group draws — exact groups of 4, excess
  teams become an ordered reserve list
- Circle-method round-robin fixture generation (3 rounds × 2 matches per
  group of 4)
- Points → goal difference → alphabetical standings, with zero other
  tiebreakers, fully unit-tested
- Qualification engine: automatic top-two, best-third-place fill to the
  next power of two, and an explicit wildcard fallback for the rare case
  where even every third-place team can't reach the target — never
  generates a bye
- Full knockout pipeline: unbiased random draw (no seeding, no protecting
  group winners), a category + role + 3 channels auto-created per round
  exactly like groups, a bracket graphic, and champion declaration —
  verified live through a full Semi Finals → Final run to a real winner
- Dual-sided result submission: a results-panel embed per group/round with
  a fixture picker, home/away-normalized score modals (manager, co-manager,
  or staff), silent auto-resolve when both sides agree, and a staff
  conflict panel when they don't — verified live end-to-end (matching
  submissions, a mismatch, and a staff override all confirmed)
- Fixtures graphic posted and pinned at the top of each group/round's chat
  channel; the results channel is reserved for the results panel
- Branded, monochrome SVG→PNG tournament graphics (group fixtures, group
  standings, knockout bracket) with the MindSet shield logo embedded,
  rendered via Sharp with content-hash caching so unchanged data never
  re-renders
- Database-backed job scheduler (`FOR UPDATE SKIP LOCKED` row-locking, so
  multiple bot processes can never double-claim a job), with retry backoff,
  dead-lettering, and crash-lease reconciliation on startup — and the
  tournament clock is actually wired to it: signup close and group
  publication fire automatically, verified live end-to-end
- Self-provisioning support ticket system — one staff command posts a panel
  with a button per ticket type; opening a ticket auto-creates a private
  channel (and the shared category, first time) with zero configuration
- Welcome/goodbye messages, auto-detecting the welcome channel by name so
  no setup is required (blocked on a Developer Portal intent toggle — see
  "Current status" above)
- Zod-validated environment configuration, Pino structured logging,
  Postgres via Drizzle ORM with committed SQL migrations

## Technical architecture

See [PLAN.md](./PLAN.md) for the full module map, database schema, and an
honest phase-by-phase build status including everything that is **not**
built yet.

Stack: Node.js (ESM) · TypeScript strict mode · discord.js v14 · PostgreSQL
via Drizzle ORM · Sharp (SVG→PNG) · Zod · Pino · Luxon · Vitest · ESLint ·
Prettier.

## Local requirements

- Node.js ≥ 20
- npm (not pnpm/yarn)
- A PostgreSQL database (a free [Neon](https://neon.tech) instance works
  fine for development)
- A Discord application + bot token (see below)

## Discord Developer Portal setup

1. Go to <https://discord.com/developers/applications> → **New
   Application**.
2. **Bot** tab → **Reset Token**, copy it → this is `DISCORD_TOKEN`.
3. **General Information** tab → copy the **Application ID** → this is
   `DISCORD_CLIENT_ID`.
4. **Bot** tab → leave **Message Content Intent** OFF (every user-facing
   flow is button/modal-driven, nothing parses message text). **Turn
   Server Members Intent ON** — the welcome/goodbye feature needs the
   `GuildMemberAdd`/`GuildMemberRemove` gateway events, which this
   privileged intent gates. `discord/intents.ts` requests
   `Guilds` + `GuildMembers`; if this toggle is off, the gateway will
   reject the connection outright with "Used disallowed intents" — verified
   live. If you don't want welcome/goodbye, you can remove
   `GatewayIntentBits.GuildMembers` from `REQUIRED_INTENTS` instead of
   enabling the portal toggle; nothing else in the bot needs it.
5. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`.

### Required bot permissions

Select these under **Bot Permissions** when generating the invite URL (the
bot creates/manages roles and channels for groups and knockout stages, so
it needs):

- Manage Roles
- Manage Channels
- View Channels
- Send Messages
- Embed Links
- Attach Files (for rendered graphics)
- Read Message History
- Manage Messages (to pin the fixtures/bracket graphic in each chat channel)
- Manage Nicknames
- Add Reactions
- Use Application Commands

Invite the bot, then in **Server Settings → Roles**, drag the bot's own
role **above** every role it needs to assign or rename (Manager/Co-Manager
nicknaming and group roles both require this — if the bot's role sits
below a target user's highest role, Discord silently rejects the rename/
role-assign and the bot logs + surfaces a non-fatal warning instead of
failing the whole action).

## PostgreSQL setup

Any Postgres 14+ instance works. For Neon specifically: create a project,
copy the pooled connection string (`postgres://user:pass@host/db?sslmode=require`)
into `DATABASE_URL`.

## Environment configuration

```
cp .env.example .env
```

Then fill in every variable — see [`.env.example`](./.env.example) for the
full annotated list. All of it is validated at startup via
[`src/config/env.ts`](./src/config/env.ts) using Zod; a missing or invalid
variable fails fast with every problem listed at once, not one at a time.

## Development commands

```bash
npm install
cp .env.example .env        # fill in real values
npm run db:migrate          # apply the committed SQL migrations
npm run commands:deploy     # register slash commands (COMMAND_DEPLOY_MODE=guild for instant dev propagation)
npm run dev                 # tsx watch — auto-restarts on file changes
```

```bash
npm run typecheck           # tsc --noEmit
npm run lint                # eslint
npm run lint:fix
npm run format               # prettier --write
npm test                    # vitest run (144 tests as of this writing)
npm run test:watch
npm run test:coverage
npm run db:generate          # generate a new migration after editing src/database/schema/
npm run db:studio            # Drizzle Studio — browse the DB in a local UI
```

## Production build

```bash
npm install
npm run build                # compiles src/ -> dist/ via tsconfig.build.json
npm start                    # node dist/index.js — no ts-node/tsx at runtime
```

## Pterodactyl deployment

**Correction, verified live against the real container:** this project was
originally documented (wrongly) as using the egg's `npm install && npm run
build && npm start` sequence. The actual egg in use here runs a fixed
startup script instead:

```
if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi;
npx ts-node /home/container/${BOT_TS_FILE}
```

That means: **no build step runs at all** — it executes the compatibility
entrypoint directly via `ts-node`, driven by the `BOT_TS_FILE` panel
variable. Set **`BOT_TS_FILE=bootstrap.cjs`**.

`bootstrap.cjs` is deliberately a plain-JavaScript Pterodactyl compatibility
launcher. It prints synchronous startup checkpoints, registers ts-node's
transpile-only ESM loader programmatically, and then starts the real
application entrypoint at `src/main.ts`. This provides correct NodeNext ESM
resolution on Node 24 even when the host omits development-only type packages.
No console command or `NODE_OPTIONS` loader variable is required.

Setup steps:

1. Create the server, point it at this repository.
2. Set `BOT_TS_FILE=bootstrap.cjs` alongside every application variable from
   `.env.example`. Do **not** commit a real `.env` file — it's gitignored.
3. Before first start (or after any schema change), run `npm run db:migrate`
   once via the panel's console.
4. Run `npm run commands:deploy` once after every deploy where slash
   commands changed (`/setup`, `/tournament`, `/payments`, `/ticket-panel`
   currently). Set `COMMAND_DEPLOY_MODE=global` for production once you're
   past active development — global propagation can take up to an hour,
   `guild` mode is instant but only registers to `DISCORD_GUILD_ID`.
5. Also make sure the **GuildMembers privileged intent** is enabled (see
   above) — without it the bot connects to the database fine and then
   fails immediately with "Used disallowed intents," which looks like a
   different problem but is the same portal toggle.

If you'd rather not rely on `ts-node` at runtime at all, the standard
`npm install && npm run build && npm start` flow (compiles to `dist/`,
then runs plain Node — no loader flags needed) also works and was verified
separately; it just isn't what this specific egg's fixed startup script
invokes, so switching to it means overriding the egg's startup command in
the panel rather than only setting variables.

## Slash-command deployment

```bash
npm run commands:deploy
```

Deploys `/setup`, `/tournament`, `/payments`, `/ticket-panel`. Controlled by
`COMMAND_DEPLOY_MODE` (`guild` | `global`) and, for guild mode,
`DISCORD_GUILD_ID`.

## First-time `/setup`

Run `/setup configure` as a server administrator. It's a two-page wizard:
role selectors (admin/staff roles, premium role, participant role), the
rules channel, the audit-log channel, and the tournament sign-up channel.
That's it — there is no category selector. Every group and every knockout
round gets its own Discord category, auto-created (and remembered) the
first time it's needed; staff never link one manually. Run `/setup status`
at any time to see exactly what's still missing — the bot refuses to
publish a tournament until every required piece of configuration is
present, and tells you precisely which ones.

## Creating a tournament

`/tournament create name:<string> date:<YYYY-MM-DD>
[channel:<#channel>] [entry_fee_pence:<int>]` — posts the persistent
tournament announcement embed. `channel` is optional; it defaults to the
tournament channel set in `/setup`. **Only one cup runs at a time per
server** — `/tournament create` refuses to start a second one while any
non-finished tournament exists for the guild (`TournamentAlreadyActiveError`),
rather than the multi-channel, multi-cup-per-week model an earlier draft of
this bot assumed. From there the flow is entirely button-driven for both
managers and staff (see the Product Overview in [PLAN.md](./PLAN.md)).

## Payment confirmation

`/payments` opens the staff payment control panel: pick a tournament, pick
a team from a searchable list, and use Confirm/Undo/Reject/Refund-tracking
buttons. Every action is logged to the audit-events table.

## Running groups

Fully automatic once a tournament is created — `/tournament create`
enqueues `PREMIUM_CUTOFF`, `SIGNUP_CLOSE`, and `GROUP_PUBLISH` jobs at their
resolved schedule times. At kickoff, `GROUP_PUBLISH` builds the eligible
(payment-confirmed) pool, runs the random draw, creates each group's own
category + role + `chat`/`results`/`staff` channels, assigns the group role
to every manager/co-manager, generates the round-robin fixtures, posts and
pins the fixtures graphic in the chat channel, posts the results panel in
the results channel, and enqueues a `FIXTURE_READY` job per fixture for its
scheduled kickoff time — all verified live against a real tournament and
the real guild.

## Testing the tournament flow — `/tournament test`

`/tournament test [team_count] [cleanup]` (staff only) runs the entire
group-publish **and** knockout pipeline immediately, against fake signups
and simulated results, instead of waiting for a real signup window, real
submitted results, and a real kickoff time. `team_count` has no upper
bound (default 8). It creates that many fake clubs/entries — all
payment-confirmed, all managed by whoever runs the command so real Discord
role-assignment actually gets exercised — runs the exact same production
pipeline `GROUP_PUBLISH` uses, then fake-resolves every group fixture with
a random score, runs the knockout draw, and keeps simulating results and
advancing rounds until a champion is decided. It verifies every phase
along the way (right membership/fixture counts, every Discord
category/role/channel actually created for both groups and knockout
rounds, every graphic actually posted, final tournament status COMPLETED)
and replies with a phase-by-phase ✅/❌ report so you can see precisely
where it broke if it did. By default (`cleanup:true`) it deletes every
Discord category/role/channel and database row it created afterward; pass
`cleanup:false` to leave everything in place for manual inspection — test
resources are named with a `TEST-`/`TEST ` prefix so they're easy to spot
and remove by hand later. It's safe to run alongside a real live
tournament: that prefix keeps its group codes and round stage names (and
therefore its Discord category/channel names) from ever colliding with a
real tournament's "Group A", "Quarter Finals", etc. — and since only one
real tournament ever runs at a time, the prefix doesn't need to be random
to guarantee that.

## Result submission, staff conflict resolution

Every fixture — group or knockout — gets a **results panel** posted to its
results channel the moment the group/round is published: an embed listing
every fixture with a live status, and a select menu of everything
currently submittable. Once a fixture's scheduled kickoff time arrives
(the `FIXTURE_READY` job walks it `SCHEDULED → READY →
WAITING_FOR_SUBMISSIONS` automatically), picking it from the menu opens a
score modal:

- **Manager or co-manager** (whichever side they're on — detected
  server-side, never trusted from the client): "Your score" / "Opponent's
  score", plus optional penalty fields for knockout fixtures.
- **Staff**: "Home score" / "Away score" directly — staff input is
  authoritative and resolves the fixture immediately, no matching needed.

A manager's submission is stored (their previous one, if any, is
deactivated but kept for audit history, not deleted) and checked against
whatever the opponent has on file. If the opponent hasn't submitted yet,
the fixture waits. If both have submitted and they **match**, the fixture
silently auto-resolves. If they **disagree**, the fixture flags
`RESULT_CONFLICT` and a conflict panel posts to the staff channel showing
both submissions side by side, with buttons to accept either one or
manually override with a fresh score. The results panel refreshes in
place (edited, never reposted) after every submission or resolution.

Once every group fixture is resolved, the knockout pipeline (see
"Testing the tournament flow" above) picks up automatically — there's no
separate trigger to run.

The domain logic behind all of this (standings, qualification, knockout
draw, home/away result normalization, knockout-specific validation) was
built and unit-tested earlier in this project; this is the Discord-facing
wiring that finally calls it. Verified live against the real database and
guild: a matching dual submission, a mismatched one, and a staff override
all confirmed to resolve correctly. What couldn't be verified interactively
is the actual button-click/modal-submit UI — there's no second Discord
account available to click as a "user" distinct from staff (same
limitation as the ticket system) — verification went through the same
service functions the real Discord handlers call. See
[PLAN.md's "Known gaps"](./PLAN.md#known-gaps) for what's still separately
missing: confirmation/overdue reminders, prize-deadline and midnight-cleanup
jobs, and an evidence/dispute system.

## Tickets

Staff run `/ticket-panel` once, anywhere, to post the panel — no other
setup. A member clicks a ticket-type button; the bot creates (or reuses)
a "Support Tickets" category and a private channel just for them, visible
only to them and staff. `Claim Ticket` marks who's handling it; `Close
Ticket` (available to the opener or staff) closes it out and deletes the
channel a few seconds later. Add a new ticket type by adding one entry to
`TICKET_TYPES` in `src/config/constants.ts` — nothing else needs to change.

## Welcome / goodbye

No setup — both events look for a text channel whose name contains
"welcome" and post there. **Requires the GuildMembers privileged intent**
to be enabled in the Developer Portal (see above); until then the bot
cannot connect to Discord at all if `GatewayIntentBits.GuildMembers` stays
in `REQUIRED_INTENTS`.

## Cleanup / Repair system

Not yet implemented (sections 33/34 of the original spec). Do not rely on
automatic midnight cleanup or the `/tournament repair` command yet — neither
exists in this codebase.

## Troubleshooting

- **"Invalid environment configuration" on startup** — the Zod validator
  lists every missing/invalid variable at once; fix them all before
  retrying.
- **Bot can't rename a manager/co-manager** — check the bot's role position
  in Server Settings → Roles; it must sit above every role the target user
  holds. The bot logs this and continues rather than failing the whole
  signup, per section 7.
- **Slash commands not showing up** — `guild` mode only registers to
  `DISCORD_GUILD_ID` and needs `npm run commands:deploy` re-run after any
  command change; `global` mode can take up to an hour to propagate on
  first deploy.
- **Migrations fail to apply** — confirm `DATABASE_URL` is reachable from
  wherever you're running `npm run db:migrate` (Neon and most managed
  Postgres providers require `?sslmode=require`).

## Backup guidance

Postgres is the single source of truth for everything except the rendered
graphic PNG cache (`GRAPHICS_CACHE_DIR`, safely regenerable — content-hash
cached, never load-bearing). Back up the database on whatever schedule your
Postgres provider offers (Neon: point-in-time restore is enabled by
default). Nothing in this system stores payment credentials — payment
tracking is manual status only, so there's no financial-credential data to
protect beyond what's already in your Discord bot token and database
connection string.

## Manual testing checklist

- [ ] `npm install && npm run build && npm start` completes with no errors
      and the bot logs "Discord client ready." (requires the GuildMembers
      intent to be enabled in the portal — see above — or the connection
      will fail with "Used disallowed intents")
- [ ] `npm run db:migrate` applies cleanly against a fresh database
- [ ] `npm run commands:deploy` registers `/setup`, `/tournament`,
      `/payments`, `/ticket-panel` and they appear in Discord
- [ ] `/setup status` correctly lists missing configuration on a fresh
      guild, and shows nothing missing after `/setup configure` completes
- [ ] `/tournament create` posts the announcement embed with correct
      branding, schedule times, and a working Sign Up button, and enqueues
      its three scheduler jobs
- [ ] Clicking Sign Up: team name modal → co-manager select → rules
      acceptance → entry created, manager/co-manager nicknamed correctly,
      ephemeral confirmation shown
- [ ] `/payments` shows the new entry as `AWAITING_PAYMENT`; Confirm Payment
      moves it to `PAYMENT_CONFIRMED` and the announcement embed's
      paid-team count updates
- [ ] At the tournament's group-publish time, groups actually appear: own
      category + role + 3 channels per group, fixtures graphic posted and
      pinned in the chat channel, a results panel posted in the results
      channel, tournament status moves to `GROUP_CONFIRMATION`
- [ ] At a fixture's scheduled kickoff time, it moves
      `SCHEDULED → READY → WAITING_FOR_SUBMISSIONS` and appears in the
      results panel's select menu
- [ ] Picking a fixture from the results panel shows the right modal (Your
      score/Opponent's score for a manager, Home/Away for staff); a
      manager's first submission moves the fixture to
      `WAITING_FOR_OPPONENT`; matching submissions from both sides
      auto-resolve it; mismatched submissions move it to `RESULT_CONFLICT`
      and post a conflict panel to the staff channel; the results panel
      updates in place after each of these
- [ ] The staff conflict panel's "Accept Submission 1/2" and "Manual
      Override" buttons all resolve the fixture correctly
- [ ] `/tournament test` (default options) reports all phases ✅ — including
      the knockout pipeline phases, ending in a declared champion and
      tournament status `COMPLETED` — and cleans up after itself; check the
      guild afterward to confirm no leftover `TEST-*`/`TEST *`
      categories/channels/roles and no leftover `TEST RUN` tournament
- [ ] `/ticket-panel` posts the panel; clicking a ticket type creates a
      private channel; Claim and Close buttons both work
- [ ] A member joining/leaving posts to the welcome channel (once the
      GuildMembers intent is enabled)
- [ ] `npm test` passes all 144 tests
- [ ] `npm run typecheck` and `npm run lint` are both clean
