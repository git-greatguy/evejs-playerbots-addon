# EveJS Playerbots

**A living population for your EveJS server.** Playerbots are real EveJS
characters, in real corporations, who play the game on their own. They mine,
build, trade, run planetary colonies, patrol, fight wars and claim space, and
they will join your corporation or fleet and fly with you when asked.

The add-on is a companion process that sits next to your EveJS server. The
server stays in charge of every character, wallet, ship, market order and
item; the add-on only decides what each bot should do next, through a private
API. It never opens the game database itself. It runs either with **Docker
Compose** or, on Windows, as a mod for **EVEJS Launcher** with no Docker.

| | |
| --- | --- |
| **Version** | 0.2.152 (Windows launcher package 0.2.152.11), experimental test build |
| **Works with** | EveJS `261115.2`, run with Docker Compose or EVEJS Launcher 1.0.91+ on Windows |
| **Dashboard** | `http://127.0.0.1:8080` on the server machine |
| **License** | AGPL-3.0-only |

This is a test build. Most of what is listed below works today; a few large
systems are built but still waiting for proof on a live server, and those are
marked. The [roadmap](PLAYERBOTS_ROADMAP.md) tracks what is done and what is
next.

**Contents:** [What the bots do](#what-the-bots-do) ·
[Install](#install) · [Run it](#run-it) · [The dashboard](#the-dashboard) ·
[Chat commands](#chat-commands) · [Settings](#settings) ·
[Your data and safety](#your-data-and-safety) · [Patches](#patches) ·
[For developers](#for-developers) · [Credits](#credits)

---

## What the bots do

### A population that grows on its own

- The roster grows gradually to the size you choose, from 30 up to 15,000
  pilots, a few at a time. Seeding slows or pauses by itself whenever the
  server is busy, so it never floods the game.
- Pilots are born across all four empires with names from their own race,
  start in their race's starter system and work from their empire's trade
  hub.
- Only some of them are online at once (300 by default). The rest take turns,
  so a large roster costs far less than the same number of live players.
- Each pilot has a **specialty** (industry, trade, planetary, security, piracy
  or sovereignty) and joins a bot corporation for it. Corporations split into
  new ones as they fill up.
- Every pilot starts with 1 billion ISK, kept back so routine work cannot
  spend it all.
- Every bot gets a portrait from 32 bundled faces, with no internet needed.
  Missing or blank portraits are repaired in the background, and existing
  bots can be refreshed once after an upgrade (custom portraits are kept).
- New bot corporations are named after famous science fiction companies
  (129 of them, from Weyland-Yutani and Tyrell Corporation to Kuat Drive Yards
  and Aperture Science), each with its own ticker, and get a random emblem
  built from the game's own corporation logo shapes and colours. Names you put
  in the dashboard's name library come first; once every sci-fi name is
  taken, corporations are named after their specialty.
- Alliance names can come from the same name library.

### Work they do without being told

A **director** looks over the roster every few minutes and gives idle pilots
something useful to do, a limited number at a time so the server stays
responsive. Their work is saved as it goes and picks up where it left off
after a restart.

- **Mining**: belt mining, then refining and selling, or delivering the ore to
  the corporation's headquarters. Security pilots can escort miners.
- **Industry**: manufacturing runs paid from a personal or corporation wallet,
  with spending limits. *(The full chain from mined ore to finished ships
  still needs live proof.)*
- **Planetary interaction**: setting up colonies, keeping extractors running,
  collecting and exporting goods. *(Profit from advanced P2+ products still
  needs live proof.)*
- **Trade**: buying and selling, standing auto-buy and auto-sell rules,
  courier contracts, and mineral buy orders outside Jita that give hubs a
  real market.
- **Ships**: upgrading along a ship ladder for their role, fitted from a
  bundled catalog of 5,353 community fits.
- **Combat**: security patrols and combat sites, pirate roams, war patrols
  and null-sec conflict.
- **Corporations and alliances**: CEOs found alliances, corporations declare
  wars on each other and fund their fleets, and alliances move goods between
  members. Bots pay part of their profit to their corporation: 60% of net
  profit to a human-led corporation and 20% of each profitable job to a
  bot-led one, by default.
- **Structures and sovereignty**: deploying Upwell structures in null-sec,
  capturing neutral hubs and running sovereignty campaigns. *(Sovereignty
  results still need live proof.)*

### Things you can do with them

- **Fly with them.** Invite bots to your corporation or fleet; in fleet chat
  tell them to follow you, escort you or attack your target.
- **Give them orders.** Send any bot you control to mine, haul, travel, fit a
  ship from your saved fittings, run industry or trade, all from chat.
- **Command whole corporations.** Recall a corporation to its headquarters and
  hold it there, send it back to work, choose where its output goes, or pick
  out individual pilots. These orders survive a server restart.
- **Recruit bots into your corporation.** Name your corporation in the
  settings and use `/bots corp inviteall`, or let the server recruit eligible
  bots automatically. Player corporations can hold up to 15,000 members and
  1,000 bots by default.
- **Watch and steer everything** from the [dashboard](#the-dashboard) in your
  browser.

### Optional extras

- **Local defense** (off by default): chosen bots respond when chosen systems
  are attacked. See [`LOCAL_DEFENSE.md`](LOCAL_DEFENSE.md).
- **Wildfire Protocol** (on by default): after you delete all bots and start
  over, about one new pilot in a hundred is born into a pirate corporation
  that hunts the systems human players use, and says "burn" in Local when it
  opens fire. Normal Crimewatch and war rules still apply.
- **Bots fighting bots** (on by default): pirate and war patrols can target
  other bots, not only humans.

### Built to keep the server healthy

The add-on also ships server-side improvements that help any busy EveJS
server: a steadier space tick, a log of any tick that holds the server for a
second or more, slower upkeep in systems nobody is watching, cleanup of sites
in long-empty systems, combat progress and profit tracking saved in batches,
roster and task lookups that avoid scanning every bot, and a Performance page
that shows where time goes. The Windows package also supports a multicore TCP
build of EveJS.

On a clean test server, 500 bots were seeded and all 500 held online at once
in about 3 GiB of server memory. See
[`PLAYERBOTS_CAPACITY_MODEL.md`](PLAYERBOTS_CAPACITY_MODEL.md) for the
measurements.

---

## Install

There are two ways to run Playerbots. Pick the one that matches how you run
EveJS:

- **Docker Compose** (Linux, macOS or Windows with Docker Desktop): follow the
  steps below.
- **EVEJS Launcher on Windows** (no Docker): import
  `dist/evejs-playerbots-windows-v0.2.152.11.zip` in **Mods → Import**, turn
  it on, and set it up under **Configure**. Full steps, upgrades and removal:
  [`windows-native/README.md`](windows-native/README.md).

Both install the same server code and the same dashboard.

### You need (Docker)

- An EveJS **`261115.2`** source checkout, set up with Docker (a fresh one or
  your existing server; existing game data is kept).
- **Docker** with the Compose v2 plugin.
- **Python 3.10** or newer, to run the installer.
- A running, healthy EveJS **Market** service. The add-on does not create the
  market; EveJS's own market tools do (see `doc/SETUP.md` in EveJS).

### Steps (Docker)

1. **Get the add-on.** Unpack `dist/evejs-playerbots-addon-v0.2.152.zip`, or
   clone this repository to install straight from its source. *(This branch's
   dashboard changes are not in that ZIP yet; install from the repository to
   get them. See [Patches](#patches).)*

2. **Check first.** This reads your EveJS checkout and reports what would
   change, without writing anything:

   ```sh
   python3 install.py --dry-run /path/to/evejs
   ```

   On Windows use `python .\install.py --dry-run "C:\path\to\evejs"`. Keep
   the quotes if the path has spaces.

3. **Install.**

   ```sh
   python3 install.py /path/to/evejs
   ```

   The installer copies the add-on into `addons/playerbots`, updates the EveJS
   server files it needs, and writes a private API token into `.env`. It backs
   up every file it replaces and never touches the game database. If a file
   was changed by an earlier manual install, it stops and lists it; re-run
   with `--replace-conflicts` once you have looked.

4. **Build and start.** Rebuild the EveJS image, start the server, wait until
   `docker compose ps` shows it **healthy**, then start the add-on:

   ```sh
   docker compose -f compose.yaml -f addons/playerbots/compose.override.yaml build init
   docker compose -f compose.yaml -f addons/playerbots/compose.override.yaml up -d --no-deps server
   docker compose -f compose.yaml -f addons/playerbots/compose.override.yaml ps server
   docker compose -f compose.yaml -f addons/playerbots/compose.override.yaml up -d --no-deps playerbots-addon
   ```

   If your setup uses extra Compose files (for example the EveJS launcher's),
   add the same `-f` files to every command. `install.py --start` does the
   build and start for you.

5. **Open the dashboard** at `http://127.0.0.1:8080`. Seeding starts after the
   server has taken two load readings, and the roster grows toward 500 pilots
   by default.

More detail, including launcher setups and every installer option:
[`INSTALLATION.md`](INSTALLATION.md).

### Check, update or remove

| To | Run |
| --- | --- |
| Check an install matches this release | `python3 verify.py /path/to/evejs` (read-only) |
| Update to a newer release | Run its `install.py` against the same checkout, then rebuild and restart as in step 4 |
| Undo the latest install | `python3 rollback.py /path/to/evejs`, then rebuild |

The installer also clears out add-on files an older release used but this one
no longer ships (they go into the install backup, and rollback puts them
back).

---

## Run it

### Everyday control

| To | Do |
| --- | --- |
| Stop the bots, keep the server up for players | `docker compose … stop playerbots-addon` |
| Start them again | `docker compose … start playerbots-addon` |
| Restart the server cleanly | Stop the add-on, restart `server`, wait for **healthy**, start the add-on |
| See what the add-on is doing | `docker compose … logs -f playerbots-addon` |
| Apply new add-on or server files | `build init`, then recreate `server` and `playerbots-addon` |

`…` stands for `-f compose.yaml -f addons/playerbots/compose.override.yaml`
plus any extra Compose files you use. Don't restart the server and the add-on
in the same command: the add-on may try to work before the server has
finished loading.

### Pausing work while the roster grows

To let a large roster seed without the bots starting work, turn **Autonomous
work** off on the Settings page (or `/playerbots autowork off`). Pilots then
show as **Standing by** with the seeding progress. Turn it back on when
seeding is done and the director starts handing out work.

Seeding puts new pilots in their race's starter system without checking the
per-system limit. The Activity page warns when a system is over it, and the
director moves pilots out once work is on.

### Common tasks

| I want to | Where |
| --- | --- |
| See what every bot is doing, and why idle ones are idle | Dashboard → **Activity** |
| Recall a corporation home and hold it there | Dashboard → **Corporations** → the corporation → **Recall all**, or `/bots corp recall` |
| Send it back to work | **Send to work**, or `/bots corp work` |
| Order just a few pilots | Tick them in the corporation's pilot list, then pick an order |
| Change roster size or online limit | Dashboard → **Settings** (takes effect without a restart) |
| Start over with a new roster | Settings → **Delete all bots** (type `DELETE ALL BOTS`) |
| Find out why something failed | [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) |

Everything else, from war mobilization to structure investment, is in
[`OPERATIONS.md`](OPERATIONS.md).

---

## The dashboard

Open `http://127.0.0.1:8080` in a browser on the server machine. There is no
login, because the dashboard can command every bot; that is why it only
listens on the local machine by default. To use it from another computer,
see [Dashboard and network](#dashboard-and-network) and do so only on a
network you trust.

| Page | What you get |
| --- | --- |
| **Activity** | The whole roster at a glance: how many pilots are working, travelling, holding, queued, cooling down, paused, standing by, idle or offline; what they are working on; why the others are not; and a searchable pilot list. |
| **Pilot panel** | Click any pilot to see what it is doing and why, where it is, its ship, the current job step by step, and its recent jobs with ISK in and out. From here you can pause, resume, stop, recall, or start mining, a PI colony, a patrol or a ship upgrade. |
| **Corporations** | Every bot corporation and what its pilots are doing. Each corporation has its own page with whole-corporation orders and live progress, its headquarters, where mined and PI goods go, its work priorities, a pilot list with checkboxes for orders to chosen pilots, and a log of every order. |
| **History** | Every finished and running job, newest first, with filters. **Details** shows a plain summary and the step-by-step timeline. |
| **World** | Systems (security, how many bots, over-limit warnings), territory (fleets, wars, structures, sovereignty) and the killboard. |
| **Performance** | Server load, how long the director takes, and long server ticks. |
| **Settings** | Autonomous work and seeding, population and work limits, advanced timings, the name library, and Delete all bots. |

The dashboard refreshes every 15 seconds and keeps your filters, selections
and unsaved edits. If something goes wrong it says so in plain words. For
example, if the dashboard is newer than the server it asks you to rebuild the
server, then recovers by itself once you have.

---

## Chat commands

Type these in game chat. `/bots` works as a short form of `/playerbots`.
`<bot>` is a bot's name or character ID.

**Who can use them:** you can command bots in your own corporation or fleet.
Server staff and admins can command any bot. A few server-wide switches are
staff-only (marked below). Every command, with examples:
[`GUIDE.md`](GUIDE.md).

### The ones you'll use most

| Command | What it does |
| --- | --- |
| `/playerbots status` | Roster size, target and corporation counts |
| `/playerbots inspect <bot>` | Everything about one bot: where it is, its wallet, ships and current job |
| `/botlocal` | Which bots are in your system (`/botlocal all` for everywhere) |
| `/playerbots invite <bot>` | Invite a bot into your corporation |
| `/playerbots fleet add <bot>` | Add a bot to your fleet |
| `/follow`, `/escort`, `/attack` | In fleet chat: follow you, escort you, attack your target |
| `/playerbots mine <bot>` | Send a bot mining |
| `/playerbots pause <bot>` / `resume <bot>` | Stop or restart one bot's own decisions |
| `/bots corp recall` / `corp work` | Recall your corporation home / send it back to work |

<details>
<summary><strong>Roster and status</strong></summary>

| Command | What it does |
| --- | --- |
| `/playerbots` or `/playerbots status` | Roster target, total and specialty corporation counts |
| `/playerbots list [filter]` | Pilots with specialty and corporation |
| `/playerbots inspect <bot>` | Corporation, fleet, location, wallet, ships, PI colonies, current job and queued work |
| `/playerbots ops [page]` | Live roster, 10 pilots per page |
| `/playerbots ops systems [page]` | Totals per solar system |
| `/playerbots ops [page] system <systemID>` | Pilots in one system |
| `/playerbots tasks [queued\|leased\|completed\|failed\|canceled]` | Saved work tasks |
| `/playerbots orders` | Player buy orders the bots can fill, and which bot has each |
| `/botlocal` or `/botlocali` | Count and locate bots in your system |
| `/botlocal all` | Bot locations across all systems |
| `/playerbots seed [30-15000]` | *Staff:* set the roster target and start seeding |

</details>

<details>
<summary><strong>Directing work</strong></summary>

| Command | What it does |
| --- | --- |
| `/playerbots autowork [status\|on\|off]` | Show or switch automatic work (*on/off: staff*) |
| `/playerbots pause <bot>` / `resume <bot>` | Pause or resume one bot's automatic work |
| `/playerbots corp pause` / `corp resume` | The same for every bot in your current corporation |
| `/playerbots op status\|stop\|resume <bot>` | Check, stop or resume a bot's current job |
| `/playerbots mine <bot> [trips] [station <id>] [norefine] [nosell]` | Mine, then unload, refine and sell |
| `/playerbots colony <bot>` | Set up a PI colony |
| `/playerbots haul <bot> <itemID\|typeID> <from> <to> [quantity]` | Move hangar goods between stations |
| `/playerbots upgrade <bot> [mining\|logistics\|security\|piracy\|sovereignty] [force]` | Buy and fit the next ship for a role |
| `/playerbots route <bot> <systemID\|system name>` | Travel by stargate |
| `/playerbots undock <bot>` · `warp <bot> <entityID>` · `dock <bot> <stationID>` | Move a bot directly |
| `/playerbots task cancel <taskID>` · `task retry <taskID>` | Cancel a queued task or retry a failed one |

</details>

<details>
<summary><strong>Corporation orders</strong></summary>

Members of the corporation and staff can give these. Only the CEO or staff can
change the saved headquarters or where goods are delivered. Leave out the
corporation ID to mean your own. Recall and work orders are saved and carried
on after a server restart.

| Command | What it does |
| --- | --- |
| `/bots corp recall [corpID] [station\|structure <id>]` | Stop all work, fly everyone to headquarters, dock and hold |
| `/bots corp work [corpID] [auto\|mine\|pi\|director] [trips <n>] [station\|structure <id>]` | Lift the hold and start work. `auto`: planetary pilots run PI, combat pilots go back to the director, everyone else mines |
| `/bots corp status [corpID]` | Who is home, held, travelling, working or idle |
| `/bots corp hq [corpID] [list \| set <id> \| clear]` | Show, list or change the headquarters |
| `/bots corp deposit [corpID] [status\|on\|off\|auto\|deliveries\|hangar <1-7>]` | Deliver mined and PI goods to headquarters instead of selling them |
| `/bots corp inviteall [status\|cancel]` | Invite every eligible bot into the corporation set as the recruitment target (CEO, director or personnel manager) |
| `/bots corp help` | Full corporation help in game |

</details>

<details>
<summary><strong>Industry, planets and trade</strong></summary>

| Command | What it does |
| --- | --- |
| `/playerbots industry cycle start <bot> <blueprintTypeID> <runs> <maxISK> [station <id>] [floor <ISK>] [corp <hangar 1-7> <wallet 1-7>]` | Run a saved manufacturing cycle, personal or for the corporation |
| `/playerbots industry cycle status\|stop\|resume <bot>` | Check, stop or resume it |
| `/playerbots industry list\|blueprints\|jobs <bot>` | Blueprints and industry jobs |
| `/playerbots industry auto set <bot> <blueprintItemID> <runs> <maxISK>` · `auto status\|off <bot>` | Automatic in-place manufacturing |
| `/playerbots task pi <bot>` | Queue PI extractor upkeep |
| `/playerbots pi export set <bot> <planetID> <maxUnits> <maxTaxISK>` · `export status\|off <bot> <planetID>` | Recurring PI exports |
| `/playerbots trade quote <bot> <typeID>` | Best local buy and sell prices |
| `/playerbots trade buy <bot> <typeID> <qty> <maxUnitPrice>` | Buy from local sellers |
| `/playerbots trade sell <bot> <itemID> [qty] <minUnitPrice>` | Sell hangar goods to local buyers |
| `/playerbots trade autosell set <bot> <typeID> <minUnitPrice> <maxUnits>` · `autosell status\|off <bot>` | Keep selling |
| `/playerbots trade autobuy set <bot> <typeID> <maxUnitPrice> <targetStock> <maxSpendPerCycle>` · `autobuy status\|off <bot>` | Keep restocking |
| `/playerbots fund <bot> <ISK>` | Give a bot you control some of your own ISK (up to 1B at a time) |
| `/playerbots courier post <issuer> <carrier> <from> <to> <itemID> <qty> <reward> <collateral>` | Courier contract between two bots |

</details>

<details>
<summary><strong>Combat, sovereignty and structures</strong></summary>

| Command | What it does |
| --- | --- |
| `/playerbots combat <bot> [security\|war\|piracy\|nullsec-conflict]` | Send a bot on a combat patrol |
| `/playerbots sovereignty <bot>` | Start sovereignty work |
| `/playerbots build <bot> <structurePackageItemID> [nullSystemID]` | Carry a structure package to null-sec and deploy it |
| `/playerbots alliance found <CEO bot>` | Found an alliance with a qualifying bot CEO |
| `/playerbots defense status\|events\|set <json>\|off\|cancel <id>` | Optional local defense (see [`LOCAL_DEFENSE.md`](LOCAL_DEFENSE.md)) |

</details>

<details>
<summary><strong>Corporations, fleets and fittings</strong></summary>

| Command | What it does |
| --- | --- |
| `/playerbots invite <bot>` | Invite the bot to your corporation; it accepts if eligible |
| `/playerbots join <bot>` | Ask the bot's corporation to invite you |
| `/playerbots fleet add <bot>` | Add the bot to your fleet |
| `/playerbots fleet join <bot>` | Ask the bot to form a fleet and invite you |
| `/playerbots fit <bot> <fittingID\|link> [maxISK]` | Fit a bot from one of your saved fittings |
| `/fitbot <fittingID\|link> [maxISK]` | The same, typed in a private chat with the bot |

In fleet chat:

| Command | What it does |
| --- | --- |
| `/follow [me\|<fleet member>\|stop]` | Fleet bots follow you or someone else |
| `/escort [me\|<fleet member>\|stop]` | Combat-fitted bots stay close and protect |
| `/attack [all\|<bot>]` | Attack the target you locked most recently |
| `/attack stop [all\|<bot>]` | Call off the attack and recall drones |

</details>

---

## Settings

### On the dashboard

Most things you'd want to change are on the **Settings** page. Changes apply
straight away, survive restarts, and win over any `.env` value. On the
Windows launcher, anything saved under **Mods → Playerbots → Configure** wins
instead and shows on this page as locked ("Set in EVEJS Launcher").

| Setting | Default | Allowed |
| --- | --- | --- |
| Autonomous work | on | on / off |
| Gradual roster seeding | on | on / off |
| Roster target | 500 | 30 – 15,000 |
| Roster ceiling | 1,500 | 30 – 15,000 |
| Most pilots online at once | 300 | 1 – 5,000 |
| Online rotation | 8 hours | 5 minutes – 7 days |
| Most bots per system | 30 | 1 – 300 |
| Work slots | 5,000 | 1 – 5,000 |
| Relocations at once | 100 | 1 – 1,000 |
| PI colony setups at once | 10 | 1 – 500 |

<details>
<summary><strong>Advanced settings</strong> (director timing, cycle and seeding safety)</summary>

| Setting | Default | Allowed |
| --- | --- | --- |
| Director think time, min / max | 90 s / 210 s | 15 s – 1 h |
| Director initial spread | 90 s | 1 s – 1 h |
| Director slice budget | 8 ms | 0 – 100 ms (0 never yields) |
| Bot steps in parallel | 16 | 1 – 100 (lowered automatically under load) |
| Cycle interval | 300 s | 30 s – 24 h |
| Delay per bot | 0 ms | 0 – 5,000 ms |
| EveJS request timeout | 120 s | 10 s – 10 min |
| Seed batch size | 5 | 1 – 10 |
| Time between seed batches | 15 s | 5 s – 5 min |
| Pause seeding above event-loop p95 | 100 ms | 25 – 250 ms |
| Pause seeding above server CPU | 85% | 25 – 95% |
| Slowest allowed pilot creation | 1,000 ms | 25 – 1,000 ms |

The seeding, ceiling and work-slot defaults come from the bundled Compose
file. Without it, seeding is off, the ceiling is 15,000 and work slots equal
the smaller of the target and the online limit.

</details>

**Limits no setting can raise:** 15,000 pilots, 5,000 online, 300 per system;
seeding at most 10 pilots per batch, pausing above 250 ms event-loop p95 or
95% CPU, and skipping any pilot that takes over a second to create.

### In `.env` (Docker) or Configure (Windows)

Server-level switches live in the EveJS `.env` file and are read when the
containers start, so recreate `server` and `playerbots-addon` after changing
them. On Windows the same switches are fields under **Mods → Playerbots →
Configure** and apply at the next Game start. Every name below starts with `EVEJS_PLAYER_BOTS_` unless written in
full. The dashboard settings above can also be given starting values here
(`TARGET`, `MAX_ONLINE`, `MAX_PER_SYSTEM` and so on; see
[`OPERATIONS.md`](OPERATIONS.md#configure-bot-count-and-connection-rotation)).

#### Corporations, recruitment and portraits

| Variable | Default | What it does |
| --- | --- | --- |
| `RECRUITMENT_CORPORATION` | empty | Player corporation that `/bots corp inviteall` and automatic recruitment fill. Name or ticker; `name:…` or `ticker:…` if both match. Empty turns recruitment off. |
| `AUTO_RECRUIT_CORPORATION` | `0` | `1` recruits eligible bots continuously, inviting as the corporation's CEO |
| `RECRUITMENT_BATCH_SIZE` | 4 | Bots handled per recruitment batch (1–16) |
| `PLAYER_CORPORATION_MEMBER_LIMIT` | 15000 | Seats in a human-led corporation, CEO included; `0` uses EveJS's skill-based limit |
| `PLAYER_CORPORATION_BOT_LIMIT` | 1000 | Most bots one human-led corporation can hold (1–15,000) |
| `PLAYER_CORP_PROFIT_SHARE_PERCENT` | 60 | Share of a bot's net profit paid to its human-led corporation |
| `BOT_CORP_OPERATION_SHARE_PERCENT` | 20 | Share of each profitable job paid to a bot-led corporation |
| `CORP_MIN_PROFIT_SHARE_ISK` | 1 | Smallest corporation payout; smaller amounts wait until they reach it |
| `REFRESH_EXISTING_PORTRAITS` | `1` | `0` keeps existing bot portraits instead of refreshing them once after upgrading |
| `SCIFI_CORPORATION_NAMES` | `1` | `0` names new bot corporations after their specialty instead of famous sci-fi companies |
| `CORPORATION_EMBLEMS` | `1` | `0` leaves new bot corporations on EveJS's default emblem instead of a random one, for example when another add-on supplies PNG logos |

Recruitment takes bots from NPC corporations or their own specialist
corporation, leaves at least five in each specialist corporation, and never
moves bots already in another player corporation. Lowering a limit stops new
joins above it; nobody is removed.

#### Dashboard and network

| Variable | Default | What it does |
| --- | --- | --- |
| `DASHBOARD_BIND` | `127.0.0.1` | Address the dashboard is published on. `0.0.0.0` opens it to your network; only do that on a network you trust, since there is no login. |
| `DASHBOARD_PORT` | `8080` | Port on the host. |
| `ADDON_TOKEN` | generated | Private key the server and add-on share. The installer creates it; never post it. |
| `ADDON_MODE` | `auto` | `disabled` makes the EveJS server run the bot cycle itself instead of the add-on process (the dashboard needs the add-on). |

<details>
<summary><strong>All other variables</strong></summary>

**Startup**

| Variable | Default | What it does |
| --- | --- | --- |
| `AUTOWORK` | on | `0` starts with autonomous work off |
| `AUTOSTART` | on | `0` turns off seeding at startup |
| `STARTUP_SEED_BATCH_SIZE` | off | 1–25: create that many pilots while starting |
| `STARTING_CAPITAL` | 1,000,000,000 | ISK each new pilot starts with |
| `ORDER_RESTORE_DELAY_MS` | 60000 | Wait after start-up before saved corporation orders are re-issued |

**Behaviour**

| Variable | Default | What it does |
| --- | --- | --- |
| `BOT_VERSUS_BOT` | on | Pirate and war patrols may target bots |
| `ENGAGEMENT` | on | Bot combat handling; `0` uses EveJS's original combat paths |
| `ENGAGEMENT_FAST_MS` / `ENGAGEMENT_FAST_SLOTS` | 2000 / 12 | How often, and how many, bots in a fight get a quick update |
| `WILDFIRE` | on | Wildfire Protocol after a roster reset |
| `MARKET_MAKING` | on | Trade pilots keep mineral orders outside Jita |
| `PATROL_ROTATION` | on | Pirates spread across destinations |
| `SITE_PRUNE` | on | Clear sites from long-unvisited systems |
| `UNOBSERVED_SITE_TICK_MS` | 10000 | Site upkeep interval where no human is in space; `0` = every tick |
| `WAR_TEST_CORPORATION_ID` | empty | Testing only: favour this human-led corporation for the first war |

**Connections inside Docker**

| Variable | Default | What it does |
| --- | --- | --- |
| `DASHBOARD_HOST` / `DASHBOARD_CONTAINER_PORT` | `0.0.0.0` / 8080 | Where the dashboard listens inside its container |
| `DASHBOARD_API_TIMEOUT_MS` | 30000 | Dashboard read timeout (10–30 s) |
| `ADDON_API_HOST` / `ADDON_API_PORT` | `0.0.0.0` / 26004 | The server's private API, inside the Docker network only |
| `ADDON_URL` | `http://server:26004` | Where the add-on finds that API |
| `IMAGE_SERVER_URL` | `http://server:26001/` | Where the dashboard gets portraits |
| `EVEJS_IMAGE_SERVER_BIND_HOST` | `0.0.0.0` | EveJS image server address |

**Diagnostics**

| Variable | Default | What it does |
| --- | --- | --- |
| `TICK_STALL_WATCH` / `TICK_STALL_MS` | on / 1000 | Log space ticks longer than this |
| `TELEMETRY_FILE` | off | `1` also writes telemetry to a file |
| `TELEMETRY_QUEUE_SCAN` | off | `1` adds a task-queue scan to telemetry |
| `TELEMETRY_BACKLOG_INTERVAL_MS` | 60000 | How often the backlog is sampled |
| `EVEJS_SPACE_TICK_SCHEDULER` | `deadline` | `interval` brings back the old tick timer |
| `EVEJS_SCHEDULER_MAX_CONCURRENT_DISPATCH` | 24 | Scheduler parallelism (max 128) |
| `EVEJS_SCHEDULER_DEAD_LETTER_ATTEMPTS` | 25 | Retries before a scheduled job is set aside |

</details>

---

## Your data and safety

- **Your game database is never touched by install, update or rollback.** The
  installer only changes source files and `.env`, and checks every file
  against known versions before writing. Anything it replaces goes into a
  dated `.playerbots-install-backup-*` folder.
- **Nothing starts on its own.** The installer leaves services stopped (unless
  you pass `--start`), never creates pilots itself, and the containers do not
  start when the machine boots.
- **Bot data lives with your game data**: pilots, jobs, corporation orders and
  the order log are in the EveJS game store, and the name library sits next to
  it. Back them up together.
- **Keep the token private.** The API token in `.env` lets anything on the
  Docker network command the server's bots. Don't paste it in logs, screenshots
  or support requests.
- **Keep the dashboard local** unless your network is trusted. It has no
  login by design.

---

## Patches

### Dashboard overhaul (`dashboard-overhaul` branch)

This copy of the add-on carries an unreleased set of changes on top of
0.2.152 by [@ubermidas](https://github.com/ubermidas), built for a local
server and intended to be offered upstream later.
Full details, tests and known limits:
[`DASHBOARD_PATCH_NOTES.md`](DASHBOARD_PATCH_NOTES.md).

**What changes for you**

- A new dashboard: six pages instead of ten, an **Activity** board that shows
  what every bot is doing and why idle ones are idle, a **pilot panel** with
  orders, and a **Corporations** page for commanding whole corporations or
  chosen pilots.
- Corporation recall and work orders, from the dashboard or `/bots corp`, now
  **survive a server restart**. They are re-issued about a minute after
  start-up.
- The dashboard is published on **127.0.0.1** by default, since it can
  command bots without a login.
- Clearer messages throughout: names instead of ID numbers, plain-language
  errors, and a prompt to rebuild when the dashboard is newer than the server.
- `/bots corp help` now lists every corporation command.
- The installer removes files older releases left behind, and rollback puts
  them back.

**Known limits**

- `/playerbots resume` in chat does not release a pilot from a corporation
  recall; after a restart it is recalled again. The dashboard's **Resume**
  does release it.
- A recall that times out (after 6 hours) is re-issued after the next restart
  unless you cancel it on the corporation page.
- These changes are tested against a mock server and a full EveJS source
  tree, but not yet on a long-running live server.

### Headquarters upkeep (`feat/corp-headquarters-structures` branch)

A follow-up to the corporation headquarters work merged upstream in 0.2.152,
also by [@ubermidas](https://github.com/ubermidas), merged into this copy:

- A corporation's structure caretaker keeps its structures fuelled and
  powered before it goes mining around headquarters, so a mining-fitted
  caretaker can no longer let them run dry.
- Every structure a corporation owns and has cored is maintained again, with
  headquarters first, including structures placed with `/playerbots build`.
- Newly deployed headquarters get a generated name instead of a fixed
  "<Corp> Headquarters".

### Luna update and Windows package (0.2.152.10 by @rizonx)

The Luna update by [@rizonx](https://github.com/rizonx), released as the
Windows launcher package *Playerbots 0.2.152.10 (Windows, Luna Update)*, is
merged into this copy. Its gameplay and performance changes now ship with
both the Docker add-on and the Windows package, and the Windows package is
built from this repository so it carries the new dashboard too.

- **Corporation recruitment**: `/bots corp inviteall [status|cancel]` and
  optional automatic recruitment into a chosen player corporation, with
  configurable member and bot limits.
- **Corporation income**: player-led corporations get 60% of their bots' net
  profit (was 40%), bot-led corporations 20% of each profitable job (was
  10%), with a minimum payout setting.
- **Portrait repair**: 32 bundled portraits, a one-time refresh of existing
  bots (old portraits backed up), background repair of missing ones, and
  local portrait serving on the Windows dashboard.
- **Performance**: buffered combat progress and profit saves, task claims and
  bot lookups without full-roster scans, cheaper corporation membership
  counts.
- **Windows launcher package**: install, disable, remove and recover from
  EVEJS Launcher, with the multicore TCP build detected automatically. Source
  in [`windows-native/`](windows-native/).

What changed while merging: the server start-up and settings code now work
with or without the Windows driver, so the same files serve both setups; the
Windows dashboard accepts `localhost` as well as `127.0.0.1`; and the new
recruitment, income and portrait settings are passed through the Docker
Compose file. In Docker, the new defaults apply after the next rebuild,
including the larger corporation income shares and the 15,000-seat member
limit for player corporations.

### Corporation names and emblems (this copy)

- New bot corporations take an unused name from a built-in list of famous
  sci-fi companies, with a unique ticker, unless the dashboard's name library
  has names for that empire. Existing corporations keep their names.
- New bot corporations get a random emblem: one to three layers from the
  client's corporation logo shapes, each in a different colour.
- Both can be turned off (`SCIFI_CORPORATION_NAMES=0`,
  `CORPORATION_EMBLEMS=0`, or under **Configure → New corporations** on
  Windows). The emblem switch is there for a future add-on that replaces
  corporation logos with PNG images; that work is kept separately and is not
  part of Playerbots.

### Installing a patch

Patches like this one arrive as source changes before a new release ZIP
exists. To apply one:

1. Get the patched source (for example `git pull` on this branch).
2. Run `python3 install.py --dry-run /path/to/evejs`, then
   `python3 install.py /path/to/evejs` from the repository folder. If it stops
   on files a previous patch changed, check the list and re-run with
   `--replace-conflicts`.
3. Rebuild and restart both the server and the add-on (step 4 of
   [Install](#install)). A patch that changes server files does nothing until
   the server is rebuilt.
4. Run `python3 verify.py /path/to/evejs` to confirm the install matches.

To go back, run `python3 rollback.py /path/to/evejs` and rebuild.

---

## For developers

<details>
<summary><strong>What's in the repository</strong></summary>

| Path | What it is |
| --- | --- |
| `addons/playerbots/index.js` | The add-on process that drives the bots |
| `addons/playerbots/dashboard-server.js`, `dashboard/` | The dashboard: plain HTML, CSS and ES modules in `dashboard/js/`, no build step |
| `addons/playerbots/compose.override.yaml` | The add-on's Docker Compose service and settings |
| `integration/server/` | The EveJS server files the add-on installs |
| `integration/manifest.json` | Supported EveJS version and checksums for every managed file |
| `install.py`, `install.sh`, `verify.py`, `rollback.py` | Installer, checker and rollback |
| `dist/` | The release ZIPs (Docker add-on and Windows launcher package) |
| `windows-native/` | Windows launcher package: mod manifest, installer helper, native driver, multicore TCP file, release history |
| `tests/` | Node test suites (`node --test tests/*.test.cjs`; some need an EveJS checkout in `EVEJS_ROOT`) |
| `GUIDE.md` | Every chat command with examples |
| `INSTALLATION.md`, `OPERATIONS.md`, `TROUBLESHOOTING.md` | Installing, running and fixing |
| `LOCAL_DEFENSE.md`, `COMMUNITY_FITTINGS.md` | Local defense and the fitting catalog |
| `PLAYERBOTS_ROADMAP.md`, `PLAYERBOTS_CAPACITY_MODEL.md` | What is planned and proven, and load measurements |
| `DASHBOARD_PATCH_NOTES.md` | Changes on this branch |

</details>

<details>
<summary><strong>Building a release</strong></summary>

The repository is the editable source; the versioned ZIP in `dist/` is what
people install. Every release must commit that ZIP alongside its source
changes. Build it against a supported EveJS checkout:

```sh
EVEJS_COMPAT_ROOT="/path/to/your EveJS 261115.2 checkout"
python tools/playerbots/build-addon-package.py --compat-root "$EVEJS_COMPAT_ROOT"
```

Check the ZIP before sharing it, and don't call a source-only commit an
installable release. The Docker ZIP now in `dist/` is the 0.2.152 build with
the headquarters upkeep patch, but without the dashboard overhaul or the Luna
update.

The Windows launcher package needs no EveJS checkout; it is built from this
repository and checked against the release history in
`windows-native/history/` so the launcher can upgrade earlier packages in
place:

```sh
python tools/playerbots/build-windows-native.py
```

</details>

---

## Credits

Built for the original EveJS server and its game services. EveJS news and
community support: the [official EveJS Discord](https://discord.gg/qrdfam8Mz).

The bundled fittings come from the EveJS Discord post "[EveJS v12.3.1] 400+
Saved Fittings", attributed by the maintainer to John Elysian (exact display
name not verified). It was supplied as XML and converted into the catalog:
5,353 usable fits, after leaving out 11 that could not be used. See
[`COMMUNITY_FITTINGS.md`](COMMUNITY_FITTINGS.md).

Playerbots and the Living Universe project share code in both directions.
Playerbots adapts Living Universe's performance helpers, patrol rotation,
space tick timer and stall watch, and Living Universe builds on parts of
Playerbots. Thanks to them for the collaboration.

**Contributors:** [@gzy40347](https://github.com/gzy40347),
[@ChaosRemnant](https://github.com/ChaosRemnant),
[@ubermidas](https://github.com/ubermidas) (dashboard overhaul, corporation
headquarters), [@rizonx](https://github.com/rizonx) (Luna update: corporation
recruitment, corporation income, portrait repair, performance work and the
Windows launcher package)

**License:** AGPL-3.0-only (see `LICENSE`). Source and license notes for
EveJS and the fittings are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
