# Dashboard overhaul — patch notes

Branch `dashboard-overhaul` on top of add-on 0.2.152 (upstream commit 139c2c3).
Local test build; not yet proposed upstream.

## What changes for the operator

### Activity page (replaces Overview, Pilots and the live half of Operations)

- Every pilot has one state: **Working**, **Travelling**, **Holding**,
  **Queued**, **Cooling down**, **Paused**, **Standing by**, **Idle** or
  **Offline**, shown as a clickable bar across the roster.
- **Working on** counts pilots by job in plain words ("Collecting PI exports",
  "Running an industry cycle"). **Why not working** counts everyone else by
  reason, including the director's own cooldown notes grouped by message.
- Pilots idling because autonomous work is off show as **Standing by**, with
  seeding progress when the roster is still seeding ("Autonomous work is off
  while the roster seeds (2,547 of 5,000)").
- A paused pilot shows as paused even mid-operation, because its operation
  does not advance while paused.
- A notice flags starter systems holding more pilots than the per-system
  limit: seeding places new pilots in their race's starter system without
  checking the limit, and the director moves residents out once work starts.
- Director strip: pilot steps this cycle, next cycle, last director pass,
  step failures. A "Needs attention" list appears when pilot steps fail.
- The pilot list filters by state, job, reason, corporation, specialty and
  name, shows names instead of IDs for station, structure, system, ship and
  corporation, and opens a pilot panel on click.

### Pilot panel

- What the pilot is doing and why, where it is, its ship, the current
  operation's step timeline, queued tasks, recent operations with ISK in and
  out, and the director's last note.
- Orders: pause, resume, stop or resume the operation, recall to the
  corporation HQ, mine (trips, station), set up a PI colony, combat patrol
  (by specialty or a chosen mode), ship upgrade (by specialty or a chosen
  ladder).
- Starting a job on a paused pilot resumes it. Resuming a pilot takes it off
  any corporation recall.

### Corporations page (replaces Corporations and Priorities)

- List of bot corporations with a state bar, top job, priorities and recall
  status; sortable by size, share not working, or name.
- A page per corporation:
  - **Orders** for the whole corporation: recall all to HQ, send to work
    (auto, mine, PI, hand back to director; trips), pause all, resume all,
    cancel, with live progress.
  - **Headquarters**: current HQ by name, set it to a corporation structure or
    any station/structure ID, or return to the corporation's own HQ; choose
    where mining and PI output from orders goes (sell, deposit at HQ,
    Corporation Deliveries, hangar division).
  - **Priorities** as an ordered list with move up/down, remove and add
    (replaces the Ctrl-click multi-select and the duplicate single-select).
  - **Pilot roster** with checkboxes: recall, send to work, pause, resume,
    stop operation, mine, PI colony, combat patrol or upgrade just the
    selected pilots, without disturbing the rest of the corporation.
  - **Command log** of orders from the dashboard and from `/bots corp` chat,
    with results.

### Orders survive restarts

- Recall and work orders, from the dashboard or `/bots corp`, are saved in the
  playerBots table and re-issued about a minute after the server starts
  (`EVEJS_PLAYER_BOTS_ORDER_RESTORE_DELAY_MS`, default 60000).
- A recall stays in force (pilots held at the HQ) until the corporation is
  sent to work, resumed or the order is cancelled. Pilots released one by one
  stay released after a restart.
- A work order keeps the pilots it has not started yet.

### History, World, Performance, Settings

- **History**: the operation archive, newest first, with plain-language
  operation names, names instead of IDs, and filters by status, type and text.
- **World**: Systems (with security, share of the roster and over-limit
  flags), Territory (fleets, wars, structures, sovereignty) and Killboard.
- **Performance**: unchanged content, new layout.
- **Settings**: autonomous work and seeding at the top with live seeding
  status; Population and Work capacity; director, cycle and seeding-safety
  values folded under Advanced; Delete all bots moved out of the settings form
  into its own panel.

### Look and feel

- Navigation cut from ten items to six: Activity, Corporations, History,
  World, Performance, Settings. Old links (`#overview`, `#operations`,
  `#priorities`, `#territory`, ...) still land on the right page.
- Larger text, sentence-case headings, short stat cards, relative times with
  the exact time on hover, no sideways-scrolling tables, a usable layout on
  narrow windows.
- Refreshes every 15 seconds without losing filters, selections, unsaved
  priority edits or the cursor in a search box. A failed refresh keeps the
  page and shows a banner.

### Security

- The dashboard port is now published on **127.0.0.1** by default, because the
  dashboard can command bots and corporations without a login. Set
  `EVEJS_PLAYER_BOTS_DASHBOARD_BIND=0.0.0.0` to reach it from other machines,
  only on a trusted network. Command requests keep the existing same-origin
  check.

## Under the hood

### New EveJS files

- `playerBotActivityState.js`: the state model, plain-language job and stage
  labels, and reason codes (pure functions, unit tested).
- `playerBotDashboardCommands.js`: per-pilot dashboard orders calling the same
  runtime functions as the `/playerbots` chat commands, up to 50 pilots per
  request, logged per corporation.

### Changed EveJS files

- `playerBotDashboardRuntime.js`: computes the state of every pilot once per
  30-second snapshot; activity counts overall and per corporation; name
  resolution for stations, structures, systems, ships, alliances and tickers;
  new `getActivity`, `getBotDetail`, `getCorporationDetail`; state, job and
  reason filters and a state sort (ranked once per snapshot) on the bot list;
  names and labels on operation history rows.
- `playerBotCorpCommands.js`: standing orders (`/_corpCommandStandingOrders`)
  holding a recall and a work order side by side, with per-pilot releases and
  per-pilot work settings; `restoreStandingOrders()`; command log
  (`/_corpCommandLog`, 40 entries per corporation); structured
  `runCorporationCommand()` for the dashboard acting as the server operator;
  station names in order messages. Saving orders no longer forces a
  synchronous flush of the playerBots table; work progress is saved at most
  every 15 seconds.
- `playerBotAddonApiRuntime.js`: new routes `GET /v1/dashboard/activity`,
  `GET /v1/dashboard/bot`, `GET /v1/dashboard/corporation`,
  `POST /v1/dashboard/corp-command`, `POST /v1/dashboard/bot-command`;
  state/activity/reason/sort parameters on `/v1/dashboard/bots`; schedules the
  order restore after start.

### Changed add-on files

- `dashboard-server.js`: proxies the new routes (commands behind the
  same-origin check), serves the dashboard as ES modules from `dashboard/js/`,
  and returns 404 for unknown static files.
- `dashboard/`: rewritten as `index.html`, `styles.css` and modules
  `app.js` (router), `api.js`, `ui.js`, `roster.js`, `drawer.js` and one
  `view-*.js` per page. The old single `app.js` is removed. No build step.
- `compose.override.yaml`: dashboard bind default `127.0.0.1`.
- `integration/manifest.json`: hashes for the changed and new files.
- Docs: `GUIDE.md`, `OPERATIONS.md`, `README.md`, `INSTALLATION.md`,
  `TROUBLESHOOTING.md` (root and add-on copies) updated for the new pages and
  bind default.

### Tests

- `tests/dashboard-activity.test.cjs` (11 tests): state classification
  (working, travelling, holding, queued, cooling, paused mid-operation,
  standing by while seeding, idle, offline), labels, pilot commands and their
  logging, recall persistence and restore, selected-pilot recall and work
  without touching the rest of the corporation, releases surviving a restart,
  Resume all lifting a recall, restoring orders saved by the first build of
  this branch, and dashboard messages without chat hints.

## Known limits

- Resuming a held pilot with the `/playerbots resume` chat command does not
  take it off the corporation recall; after a restart it is recalled again.
  The dashboard's Resume does.
- A recall that times out (6 hours) keeps its saved record and is re-issued
  after the next restart; cancel it on the corporation page if that is not
  wanted.
- The new server code is unit tested and was driven end to end against a mock
  EveJS with 2,547 pilots; it has not yet run inside a live EveJS server.
