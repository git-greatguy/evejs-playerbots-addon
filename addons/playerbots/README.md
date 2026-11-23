# EveJS Playerbots Add-on

Autonomous player characters for an [EveJS](https://discord.gg/qrdfam8Mz)
server. Bots are real EveJS characters in real corporations: they mine, run
industry and planetary interaction, trade, patrol, fight wars, deploy
structures and fly in fleets with human players, all through the server's own
game services.

The add-on runs the playerbot director as a separate Node.js process. The game
server stays authoritative for characters, corporations, wallets, market
orders, inventory, planetary colonies, ships, contracts, sovereignty and
movement. The add-on talks to a private HTTP API inside the Docker network and
has no database connection.

| | |
| --- | --- |
| Add-on version | **0.2.152**, experimental public test build |
| Targets | EveJS source version `261115.2` |
| Runtime | Node.js 24 or later, Docker Compose |
| Dashboard | `http://127.0.0.1:8080`, no login |
| License | AGPL-3.0-only |

> **This branch (`dashboard-overhaul`)** replaces the operator dashboard with
> an activity board, direct corporation control and per-pilot orders, makes
> dashboard and `/bots corp` orders survive restarts, and publishes the
> dashboard on `127.0.0.1` by default. It is a local build that has not yet
> been proposed upstream. See [`DASHBOARD_PATCH_NOTES.md`](DASHBOARD_PATCH_NOTES.md)
> for the full list of changes, tests and known limits.

This is a test build, not a finished product. The
[roadmap](PLAYERBOTS_ROADMAP.md) is the source of truth for features still
being built or still waiting for live evidence; the features below note where
that applies.

## Contents

- [Quick start](#quick-start)
- [Features](#features)
- [Operator dashboard](#operator-dashboard)
- [Commands](#commands)
- [Options](#options)
- [Safety and persistence](#safety-and-persistence)
- [Package contents](#package-contents)
- [Distribution contract](#distribution-contract)
- [Credits, license and contributors](#credits-and-provenance)

## Quick start

1. Start from a clean EveJS `261115.2` source checkout (an existing deployment
   also works; its databases are not touched).
2. Unpack `dist/evejs-playerbots-addon-v0.2.152.zip` and run the installer
   against the checkout:

   ```sh
   python3 install.py --dry-run /path/to/evejs   # check only, writes nothing
   python3 install.py /path/to/evejs             # install the overlay and .env settings
   ```

3. Run EveJS's normal first-run setup and seed the Jita market with EveJS's own
   market tools. The add-on seeds bot characters, not the market.
4. Build and start the server and the add-on (or pass `--start` to the
   installer):

   ```sh
   docker compose -f compose.yaml -f addons/playerbots/compose.override.yaml build init
   docker compose -f compose.yaml -f addons/playerbots/compose.override.yaml up -d --no-deps server playerbots-addon
   ```

5. Open the dashboard at `http://127.0.0.1:8080`. The roster seeds gradually
   toward the target (500 by default) while load stays under the seeding
   limits.

Full steps, upgrades and rollback: [`INSTALLATION.md`](INSTALLATION.md).
Day-to-day running: [`OPERATIONS.md`](OPERATIONS.md). Problems:
[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). Every chat command in detail:
[`GUIDE.md`](GUIDE.md).

## Features

### Population

- **Gradual roster seeding** to a target of 30–15,000 pilots, in small batches
  that back off when the EveJS event loop, CPU or a single pilot creation gets
  slow. Seeding waits for load samples before it starts and while the first
  human client of a bot-only server logs in. It never bulk-inserts.
- **All four empires.** New pilots are born across Amarr, Caldari, Gallente
  and Minmatar with names from their own race, and work from their empire's
  hub. Relocating pilots prefer the least crowded nearby system.
- **Online rotation.** At most 300 bots are online at once by default; the rest
  stay in the roster and take turns on a configurable window. A per-system
  limit (30 by default) keeps crowds out of single systems.
- **Six specialties**, each with its own bot corporations (shards of up to 300
  pilots, 250 targeted): industry (mining and manufacturing), trade,
  planetary, security, piracy and sovereignty.
- **Starting capital** of 1B ISK per pilot by default, protected from being
  spent on routine work.
- **Portraits work offline**, from the optional CCP agent image pool or a
  locally generated image; the dashboard streams them through the same origin.
- **Corporation and alliance names** can come from a name library edited in
  the dashboard.
- **Delete all bots** from the dashboard to start the roster over, optionally
  seeding a new one.

### The director

- A roster-wide **director** gives idle pilots work in bounded waves (at most
  20 starts per pass), spreads think time across the roster, and hands control
  back to EveJS between pilots once a pass has used its slice budget.
- Work is **durable**: operations and tasks are stored and resume after a
  restart, with retries for travel stages and wallet/inventory reconciliation
  before a task is retried.
- **Corporation priorities** decide which pilots in a corporation the director
  serves first.
- A failed or finished assignment does not strand a pilot: combat pilots with
  no reachable target get mining or a mining-hull upgrade, stale cooldowns are
  released, and capacity-paused jobs resume.
- **Autonomous work can be switched off** (from the dashboard or
  `/playerbots autowork off`), for example while a large roster seeds; pilots
  then show as *Standing by*.

### Economy

- **Mining** from asteroid belts with refining and selling, or deposit of the
  output at the corporation HQ, Corporation Deliveries or a hangar division.
  Security pilots can escort miners in belts.
- **Industry**: durable manufacturing cycles on a personal or corporation
  wallet and hangar, with spend caps and a price floor, plus a narrower
  automatic in-place policy. The complete bot-mined ship chain still needs
  live proof.
- **Planetary interaction**: colony setup, extractor maintenance, scheduled
  collection and export. The planner supports P0-to-P4 networks; live P2+
  profitability still needs proof.
- **Trade**: quotes, immediate buys and sells, recurring auto-sell and
  auto-buy policies, ISK transfers and private courier contracts. Trade pilots
  keep real mineral buy and sell orders outside Jita (market making).
- **Ship upgrades** along role ladders (mining, logistics, security, piracy,
  sovereignty) using the bundled FitALL catalog of 5,353 community fits, and
  `/fitbot` to fit a bot from a saved fitting.

### Corporations, alliances and war

- **Corporation orders**: recall a whole corporation (or chosen pilots) to its
  HQ and hold it there, send it back to work (mining, PI or the director),
  pause and resume. Orders survive a restart.
- **Headquarters** can be the corporation's NPC station or a corporation-owned
  structure with docking online.
- **Alliances**: qualifying bot CEOs found alliances; alliance couriers move
  goods between members.
- **Wars**: bot corporations with a war headquarters declare normal wars on
  each other and mobilize (war grant, stipends, cross-training, a
  Algos → Vexor → Myrmidon → Dominix ladder). Playerbots can be legal targets
  for each other's piracy and war patrols.
- **Sovereignty and structures**: neutral hub capture, sovereignty campaigns,
  Upwell structure deployment from a package into claimable null-sec, and
  security patrols during null-sec structure rivalries. Live sovereignty
  results still need evidence.

### Combat and safety

- **Security patrols and combat anomalies**, **piracy** patrols that rotate
  between destinations (capped at six patrols per system), **war** and
  **null-sec conflict** patrols.
- **Engagement handling** for pilots in active fights (approach, orbit,
  drones, target locks), threat responses, and capsule recovery.
- **Fleet play with humans**: bots join your corporation or fleet, follow you,
  escort you and attack your locked target on command.
- **Local defense** (opt-in, off by default): chosen responders defend chosen
  systems. See [`LOCAL_DEFENSE.md`](LOCAL_DEFENSE.md).
- **Wildfire Protocol** (on by default): after a *Delete all bots*, about one
  new pilot in a hundred is born into a piracy corporation that hunts the
  systems human players use and says "burn" in Local when it opens fire.
  Normal Crimewatch, war and security rules still decide who may be attacked.

### Performance

- **Fixed-deadline space tick** (100 ms grid) so a late tick does not push
  later ticks back, and a **stall watch** that records any tick holding the
  server for a second or more, with the systems it spent the time in.
- **Unobserved systems** run dungeon and incursion upkeep every ten seconds
  instead of every second, and seeded sites are pruned from systems no human
  has visited for thirty days.
- **Load controller**: the add-on lowers its own concurrency under load.
- **Performance page and telemetry endpoint**: event loop, CPU, memory, garbage
  collection, scheduled playerbot work, time per subsystem, tick stalls.

Measured so far: a clean remote test seeded 500 bots and held all 500 online at
once (2.6–3.2 GiB server memory, usually 96–426 ms event-loop p95, with one
18-second spike during the first connection wave). That validates the session
count, not sustained work throughput. See
[`PLAYERBOTS_CAPACITY_MODEL.md`](PLAYERBOTS_CAPACITY_MODEL.md).

## Operator dashboard

Served by the add-on on port 8080. It needs no login, so it is published on
`127.0.0.1` only; see [Options](#dashboard-and-network) to change that.

| Page | What it shows and does |
| --- | --- |
| **Activity** | Every pilot's state (Working, Travelling, Holding, Queued, Cooling down, Paused, Standing by, Idle, Offline) as a clickable bar; what pilots are working on and why the rest are not; the director's last pass; starter systems over the per-system limit; a filterable pilot list. |
| **Pilot panel** | Opens from any pilot: what it is doing and why, location, ship, operation timeline, queued tasks, recent operations with ISK in and out. Orders: pause, resume, stop or resume the operation, recall to HQ, mine, PI colony, combat patrol, ship upgrade. |
| **Corporations** | Every bot corporation with its state bar, top job, priorities and recall status. Each corporation's page has whole-corporation orders with live progress, headquarters and output delivery settings, an ordered priority list, a pilot roster with checkboxes for orders to selected pilots, and a command log. |
| **History** | The operation archive, newest first, filterable by status, type and text. **Details** opens a summary of one operation (pilot, job, status, place, ship, ISK, last step) with its step timeline; the full raw record is folded underneath. |
| **World** | Systems (security, share of the roster, over-limit flags), territory (fleets, wars, structures, sovereignty) and the killboard. |
| **Performance** | Server load, director timing, tick stalls and telemetry. |
| **Settings** | Autonomous work and seeding with live seeding status, population and work limits, advanced director and seeding-safety values, the name library, and Delete all bots. Saved settings show their defaults and take effect without a restart. |

The page refreshes every 15 seconds without losing filters, selections or
unsaved edits. Errors from EveJS are shown in plain words: a pilot,
corporation or operation that no longer exists says so and links back to its
list instead of retrying, and a dashboard newer than the EveJS server says the
server needs rebuilding (the page recovers by itself once it is).

## Commands

Commands are typed in game chat. `/bots` is an alias for `/playerbots`.
`<bot>` is a bot's name or character ID. You can control bots in your own
corporation or fleet; staff and admin accounts can control any bot. The full
reference with examples is in [`GUIDE.md`](GUIDE.md).

### Roster and status

| Command | Does |
| --- | --- |
| `/playerbots` or `/playerbots status` | Roster target, total and specialty corporation counts. |
| `/playerbots list [filter]` | Pilots with specialty and corporation. |
| `/playerbots inspect <bot>` | Corporation, fleet, location, wallet, ships, PI colonies, current operation and queued work. |
| `/playerbots ops [page]` | Live roster pages, 10 pilots per page. |
| `/playerbots ops systems [page]` | Totals per solar system. |
| `/playerbots ops [page] system <systemID>` | Pilots in one system. |
| `/playerbots tasks [queued\|leased\|completed\|failed\|canceled]` | Durable work tasks. |
| `/playerbots orders` | Player buy orders the bots can fill, and which bot has each. |
| `/botlocal` or `/botlocali` | Count and locate bots in your system. |
| `/botlocal all` | Bot locations across all systems. |
| `/playerbots seed [30-15000]` | Staff: set the roster target and start gradual seeding. |

### Autonomous work and operations

| Command | Does |
| --- | --- |
| `/playerbots autowork [status\|on\|off]` | Show or switch the director (on/off: staff). |
| `/playerbots pause <bot>` / `resume <bot>` | Pause or resume one bot's autonomous work. |
| `/playerbots corp pause` / `corp resume` | Pause or resume the bots in your current corporation. |
| `/playerbots op status\|stop\|resume <bot>` | Inspect, stop or resume a bot's current operation. |
| `/playerbots mine <bot> [trips] [station <id>] [norefine] [nosell]` | Mine belts and unload, refine and sell. |
| `/playerbots colony <bot>` | Set up a PI colony. |
| `/playerbots haul <bot> <itemID\|typeID> <from> <to> [quantity]` | Haul hangar goods between stations. |
| `/playerbots upgrade <bot> [mining\|logistics\|security\|piracy\|sovereignty] [force]` | Buy and fit the next ship on a role ladder. |
| `/playerbots route <bot> <systemID\|system name>` | Travel by stargate route. |
| `/playerbots undock <bot>` / `warp <bot> <entityID>` / `dock <bot> <stationID>` | Direct movement. |
| `/playerbots task cancel <taskID>` / `task retry <taskID>` | Cancel a queued task or retry a failed one. |

### Corporations

Members of the corporation and staff can use these; only the CEO or staff can
change the saved HQ or deposit settings. Omit the corporation ID to use your
own corporation. Recall and work orders are saved and re-issued after a
server restart.

| Command | Does |
| --- | --- |
| `/bots corp recall [corpID] [station\|structure <id>]` | Stop every pilot's work, send it to the HQ, dock and hold it there. |
| `/bots corp work [corpID] [auto\|mine\|pi\|director] [trips <n>] [station\|structure <id>]` | Lift the hold and start work. `auto`: planetary pilots set up PI, combat specialties return to the director, everyone else mines. |
| `/bots corp status [corpID]` | Pilots at the HQ, held, travelling, working and idle, with recall progress. |
| `/bots corp hq [corpID] [list \| set <id> \| clear]` | Show, list or change the HQ the orders use. |
| `/bots corp deposit [corpID] [status\|on\|off\|auto\|deliveries\|hangar <1-7>]` | Deliver mining and PI output to the HQ instead of selling it. |
| `/bots corp help` | Full corporation help. |

### Industry, PI and trade

| Command | Does |
| --- | --- |
| `/playerbots industry cycle start <bot> <blueprintTypeID> <runs> <maxISK> [station <id>] [floor <ISK>] [corp <hangar 1-7> <wallet 1-7>]` | Run a durable manufacturing cycle, personal or corporate. |
| `/playerbots industry cycle status\|stop\|resume <bot>` | Inspect, stop or resume the cycle. |
| `/playerbots industry list\|blueprints\|jobs <bot>` | Blueprints and industry jobs. |
| `/playerbots industry auto set <bot> <blueprintItemID> <runs> <maxISK>` / `auto status\|off <bot>` | In-place automatic industry policy. |
| `/playerbots task pi <bot>` | Queue PI extractor maintenance. |
| `/playerbots pi export set <bot> <planetID> <maxUnits> <maxTaxISK>` / `export status\|off <bot> <planetID>` | Recurring PI exports. |
| `/playerbots trade quote <bot> <typeID>` | Best local buy and sell quotes. |
| `/playerbots trade buy <bot> <typeID> <qty> <maxUnitPrice>` | Buy from local stock. |
| `/playerbots trade sell <bot> <itemID> [qty] <minUnitPrice>` | Sell hangar goods into local buy orders. |
| `/playerbots trade autosell set <bot> <typeID> <minUnitPrice> <maxUnits>` / `autosell status\|off <bot>` | Recurring sales. |
| `/playerbots trade autobuy set <bot> <typeID> <maxUnitPrice> <targetStock> <maxSpendPerCycle>` / `autobuy status\|off <bot>` | Recurring restocking. |
| `/playerbots fund <bot> <ISK>` | Give your own ISK to a bot you control (up to 1B per transfer). |
| `/playerbots courier post <issuer> <carrier> <from> <to> <itemID> <qty> <reward> <collateral>` | Private courier contract between two bots. |

### Combat, sovereignty and structures

| Command | Does |
| --- | --- |
| `/playerbots combat <bot> [security\|war\|piracy\|nullsec-conflict]` | Start a combat assignment. |
| `/playerbots sovereignty <bot>` | Start sovereignty work. |
| `/playerbots build <bot> <structurePackageItemID> [nullSystemID]` | Carry a structure package to claimable null-sec and deploy it. |
| `/playerbots alliance found <CEO bot>` | Found an alliance with a qualifying bot CEO. |
| `/playerbots defense status\|events\|set <json>\|off\|cancel <id>` | Opt-in local defense (see [`LOCAL_DEFENSE.md`](LOCAL_DEFENSE.md)). |

### Fleets, corporations and fittings

| Command | Does |
| --- | --- |
| `/playerbots invite <bot>` | Invite the bot to your corporation; it accepts eligible invitations. |
| `/playerbots join <bot>` | Ask the bot's corporation to invite you. |
| `/playerbots fleet add <bot>` | Add the bot to your fleet. |
| `/playerbots fleet join <bot>` | Ask the bot to form a fleet and invite you. |
| `/playerbots fit <bot> <fittingID\|link> [maxISK]` | Fit a bot from a saved fitting. |
| `/fitbot <fittingID\|link> [maxISK]` | The same, typed in a private chat with the bot. |

In fleet chat:

| Command | Does |
| --- | --- |
| `/follow [me\|<fleet member>\|stop]` | Fleet bots follow you or another fleet member. |
| `/escort [me\|<fleet member>\|stop]` | Fitted security bots escort at close range. |
| `/attack [all\|<bot>]` | Fleet bots attack your most recently locked target. |
| `/attack stop [all\|<bot>]` | Recall drones and withdraw attack orders. |

## Options

### Dashboard settings

Set on the dashboard's **Settings** page; they are stored in the game store,
take effect without a restart, and override the environment values below.
Seeding safety values cannot go above the hard caps.

| Setting | Default | Range |
| --- | --- | --- |
| Autonomous work | on | on / off |
| Gradual roster seeding | on (Compose) | on / off |
| Roster target | 500 | 30–15,000 |
| Roster ceiling | 1,500 (Compose) | 30–15,000 |
| Most pilots online | 300 | 1–5,000 |
| Online rotation | 8 hours | 5 minutes–7 days |
| Most pilots per system | 30 | 1–300 |
| Work slots | 5,000 (Compose) | 1–5,000 |
| Relocations at once | 100 | 1–1,000 |
| PI colony setups at once | 10 | 1–500 |
| Director think min / max | 90 s / 210 s | 15 s–1 h |
| Director initial spread | 90 s | 1 s–1 h |
| Director slice budget | 8 ms | 0–100 ms (0 never yields) |
| Bot steps in parallel | 16 | 1–100 |
| Cycle interval | 300 s | 30 s–24 h |
| Delay per bot | 0 ms | 0–5,000 ms |
| EveJS request timeout | 120 s | 10 s–10 min |
| Seed batch size | 5 | 1–10 |
| Time between seed batches | 15 s | 5 s–5 min |
| Pause seeding above event-loop p95 | 100 ms | 25–250 ms |
| Pause seeding above EveJS CPU | 85% | 25–95% |
| Slowest allowed pilot creation | 1,000 ms | 25–1,000 ms |

"(Compose)" marks values set by the bundled `compose.override.yaml`; without
it the code defaults are seeding off, a ceiling of 15,000 and work slots equal
to the smaller of the target and the online limit.

### Environment variables

Set in the EveJS `.env` file (the installer writes the required ones) and read
at container start. All names start with `EVEJS_PLAYER_BOTS_` unless shown in
full. The population, work, director and seeding values in the table above can
also be set here (`TARGET`, `ROSTER_CEILING`, `MAX_ONLINE`,
`CONNECTION_WINDOW_MS`, `MAX_PER_SYSTEM`, `MAX_CONCURRENT_WORK`,
`MAX_CONCURRENT_CAPACITY_RELOCATIONS`, `MAX_CONCURRENT_COLONY_SETUPS`,
`DIRECTOR_THINK_MIN_MS`, `DIRECTOR_THINK_MAX_MS`, `DIRECTOR_INITIAL_SPREAD_MS`,
`DIRECTOR_SLICE_BUDGET_MS`, `ADDON_CONCURRENCY`, `ADDON_INTERVAL_MS`,
`ADDON_BOT_DELAY_MS`, `ADDON_REQUEST_TIMEOUT_MS`, `ROSTER_SEED_ENABLED`,
`ROSTER_SEED_BATCH_SIZE`, `ROSTER_SEED_INTERVAL_MS`,
`ROSTER_SEED_MAX_EVENT_LOOP_P95_MS`, `ROSTER_SEED_MAX_PROCESS_CPU_PERCENT`,
`ROSTER_SEED_MAX_SINGLE_BOT_MS`); saved dashboard settings take precedence.

#### Startup and work

| Variable | Default | Effect |
| --- | --- | --- |
| `AUTOWORK` | on | `0` starts with autonomous work off. |
| `AUTOSTART` | on | `0` turns off the startup seeding path. |
| `STARTUP_SEED_BATCH_SIZE` | off | 1–25 creates that many pilots during startup. |
| `STARTING_CAPITAL` | 1,000,000,000 | ISK given to each new pilot. |
| `ORDER_RESTORE_DELAY_MS` | 60000 | Delay before saved corporation orders are re-issued after a start. |

#### Dashboard and network

| Variable | Default | Effect |
| --- | --- | --- |
| `DASHBOARD_BIND` | `127.0.0.1` | Host address the dashboard port is published on. Use `0.0.0.0` only on a trusted network: the dashboard can command bots without a login. |
| `DASHBOARD_PORT` | 8080 | Host port. |
| `DASHBOARD_HOST` / `DASHBOARD_CONTAINER_PORT` | `0.0.0.0` / 8080 | Listen address inside the container. |
| `DASHBOARD_API_TIMEOUT_MS` | 30000 | Timeout for dashboard reads, 10000–30000; the dashboard uses the request timeout setting, capped at 30 s. |
| `ADDON_MODE` | `auto` | `disabled` turns off the external add-on process mode. |
| `ADDON_TOKEN` | generated | 256-bit API token shared by server and add-on (at least 32 characters). Keep it private. |
| `ADDON_API_HOST` / `ADDON_API_PORT` | `0.0.0.0` / 26004 | Private API listener inside the Docker network. |
| `ADDON_URL` | `http://server:26004` | Where the add-on reaches the API. |
| `IMAGE_SERVER_URL` | `http://server:26001/` | Where the dashboard fetches portraits. |
| `EVEJS_IMAGE_SERVER_BIND_HOST` | `0.0.0.0` | EveJS image server listen address. |

#### Behaviour switches

| Variable | Default | Effect |
| --- | --- | --- |
| `BOT_VERSUS_BOT` | on | Bots can be legal targets for each other's piracy and war patrols. |
| `ENGAGEMENT` | on | Playerbot engagement handling; `0` uses the original host combat paths. |
| `ENGAGEMENT_FAST_MS` / `ENGAGEMENT_FAST_SLOTS` | 2000 / 12 | Step interval for pilots in an active fight, and how many pilots get it at once. |
| `WILDFIRE` | on | Wildfire Protocol after a roster reset. |
| `MARKET_MAKING` | on | Trade pilots keep mineral buy orders outside Jita. |
| `PATROL_ROTATION` | on | Piracy destinations rotate instead of all going to the nearest. |
| `SITE_PRUNE` | on | Remove seeded sites from long-unvisited systems. |
| `UNOBSERVED_SITE_TICK_MS` | 10000 | Site upkeep interval in systems with no human in space; `0` restores every-tick upkeep. |
| `WAR_TEST_CORPORATION_ID` | empty | Test only: picks this human-CEO corporation first for the first-war grant. |

#### Diagnostics and scheduler

| Variable | Default | Effect |
| --- | --- | --- |
| `TICK_STALL_WATCH` / `TICK_STALL_MS` | on / 1000 | Record space ticks longer than this. |
| `TELEMETRY_FILE` | off | `1` also writes telemetry to a file. |
| `TELEMETRY_QUEUE_SCAN` | off | `1` adds a task-queue scan to telemetry. |
| `TELEMETRY_BACKLOG_INTERVAL_MS` | 60000 | Backlog sampling interval. |
| `EVEJS_SPACE_TICK_SCHEDULER` | `deadline` | `interval` restores the plain interval timer. |
| `EVEJS_SCHEDULER_MAX_CONCURRENT_DISPATCH` | 24 (Compose), max 128 | Durable scheduler parallelism. |
| `EVEJS_SCHEDULER_DEAD_LETTER_ATTEMPTS` | 25 | Attempts before a scheduled job is dead-lettered. |

### Hard limits

These cannot be raised by settings: 15,000 pilots in the roster, 5,000 online,
300 per system; seeding at most 10 pilots per batch, pausing above 250 ms
event-loop p95 or 95% EveJS CPU, and rejecting pilot creations slower than
1,000 ms.

### Installer and tools

| Command | Does |
| --- | --- |
| `install.py [--dry-run] [--replace-conflicts] [--start] [target]` | Install into an EveJS checkout (default: current directory). `--dry-run` checks without writing; `--replace-conflicts` backs up and replaces modified managed files; `--start` builds and starts only the server and add-on. Add-on files that earlier releases installed but this one no longer uses (the old single-file `dashboard/app.js`) are moved into the install backup. `install.sh` runs the same thing. |
| `verify.py [--json] [--strict] [--subsystem <name>] [target]` | Check an installed tree against this release without changing anything. |
| `rollback.py [target]` | Roll back the latest installation from its backup, including any files the install moved aside. |

## Safety and persistence

The installer validates the source version and every managed source-file hash
before it writes anything. Existing modified files that match neither the
supported original nor this release cause installation to stop. Before it
replaces source files, the installer backs them up to a timestamped
`.playerbots-install-backup-*` directory in the EveJS source tree.

Installation and rollback do not read, write, migrate, move, or delete EveJS
databases. By default, installation only updates source files and `.env`,
checks the Compose configuration, and leaves services stopped. The optional
`--start` switch rebuilds the image and starts the EveJS server and add-on; it
does not start, stop, or rebuild the Market service. EveJS server and add-on
containers use `restart: "no"`, so Docker does not start them at machine boot.
The install step itself never creates pilots or begins roster seeding. If
`--start` is used, the add-on waits for load telemetry and then seeds gradually
under the hard caps above; it never performs a bulk roster insert.

Bot state, operations, tasks, corporation orders and the command log are kept
in the EveJS game store (`playerBots` table); the name library is
`playerbots-name-library.json` in the same store root. Back them up with the
server's data.

The API token is generated locally with 256 bits of randomness and stored in
the EveJS `.env` file with owner-only permissions on Linux. It is passed only
between the server and add-on containers. Do not publish it in logs,
screenshots, or support bundles.

## Package contents

- `addons/playerbots/index.js`: standalone roster-cycle driver.
- `addons/playerbots/dashboard-server.js` and `dashboard/`: the operator
  dashboard (`index.html`, `styles.css`, and ES modules in `dashboard/js/`, no
  build step), served by the add-on process on container port 8080. Portraits
  load through a same-origin proxy to EveJS's image service.
- `addons/playerbots/compose.override.yaml`: private sidecar service and API
  settings for Docker Compose.
- `integration/server/`: the exact EveJS server source files this release
  needs, and `integration/manifest.json` with the supported EveJS version and
  SHA-256 guards for the original source and the overlay.
- `integration/server/server/assets/fittings/fitall.json`: the bundled FitALL
  community fitting catalog.
- `install.py`, `install.sh`, `rollback.py`, `verify.py`: guarded installer,
  rollback and verification.
- `dist/`: the versioned installation ZIP.
- `tests/`: Node test suites (`node --test tests/*.test.cjs`); some need an
  EveJS checkout in `EVEJS_ROOT`.
- Documentation:
  - [`INSTALLATION.md`](INSTALLATION.md), [`OPERATIONS.md`](OPERATIONS.md),
    [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md), [`GUIDE.md`](GUIDE.md):
    installation, running, recovery and the full command reference.
  - [`LOCAL_DEFENSE.md`](LOCAL_DEFENSE.md): the opt-in local defense service.
  - [`COMMUNITY_FITTINGS.md`](COMMUNITY_FITTINGS.md): the fitting catalog and
    the server fitting endpoint.
  - [`PLAYERBOTS_CAPACITY_MODEL.md`](PLAYERBOTS_CAPACITY_MODEL.md): population
    definitions, measurements and load gates.
  - [`PLAYERBOTS_ROADMAP.md`](PLAYERBOTS_ROADMAP.md): the feature register,
    acceptance criteria and open evidence gaps.
  - [`DASHBOARD_PATCH_NOTES.md`](DASHBOARD_PATCH_NOTES.md): changes on this
    branch.
  - [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md): EveJS project and
    community fitting credits.

## Distribution contract

The repository is the editable source; the versioned ZIP in `dist/` is the
standard installation and redistribution artifact. Every playerbots release
must include that ZIP in Git alongside the source changes. Build it with
`tools/playerbots/build-addon-package.py` and pass the local path of the
supported EveJS checkout explicitly, for example:

```sh
EVEJS_COMPAT_ROOT="/path/to/your EveJS 261115.2 checkout"
python tools/playerbots/build-addon-package.py --compat-root "$EVEJS_COMPAT_ROOT"
```

Validate the resulting ZIP before distribution. Do not describe a source-only
commit as an installable release. (The ZIP currently in `dist/` is the
upstream 0.2.152 build and does not contain this branch's dashboard changes.)

## Credits and provenance

This add-on is built for the original EveJS server and uses its native game
services. EveJS project information and community support are available on the
[official EveJS Discord](https://discord.gg/qrdfam8Mz). See
`THIRD_PARTY_NOTICES.md` for the source and license notes.

The bundled fitting data comes from the EveJS Discord post titled
“[EveJS v12.3.1] 400+ Saved Fittings,” attributed by the maintainer to John
Elysian (the exact Discord display name and spelling have not been verified).
The source was supplied as XML and converted into the static catalog; no
message permalink was included with the supplied files. The package contains
5,353 usable fits after excluding 11 entries without a usable fit. See
`COMMUNITY_FITTINGS.md` for the data provenance note.

## License

This package is distributed under the repository's AGPL-3.0-only license. See
`LICENSE`.

## Contributors

- [@gzy40347](https://github.com/gzy40347)
- [@ChaosRemnant](https://github.com/ChaosRemnant)

## Acknowledgements

Playerbots and the Living Universe project share code in both directions in
an open, collaborative spirit: Living Universe builds on parts of Playerbots,
and Playerbots adapts some of Living Universe's work, including the
performance helpers, the patrol rotation helpers, the space tick timer and the
stall watch. Thanks to the Living Universe project for the collaboration. See
`THIRD_PARTY_NOTICES.md` for the details and licenses.
