# 0.2.152.11

- Built from the Playerbots repository: the same server files as the Docker
  add-on, so the two stay in step.
- The overhauled operator dashboard (Activity, Corporations, History, World,
  Performance, Settings) replaces the single-page dashboard. Launcher-managed
  settings are shown locked.
- Corporation recall and work orders survive a server restart.
- Headquarters upkeep: structure maintenance runs before HQ mining and every
  owned structure is maintained.
- The dashboard also accepts `localhost` as well as `127.0.0.1`.
- New bot corporations take famous sci-fi company names and random in-game
  emblems (Configure → New corporations).

# 0.2.152.7

- Buffered combat progression saves. A pending tier and its duplicate-site
  checks are visible immediately, with storage updates about once per minute
  and during graceful shutdown.

# 0.2.152.6

- Added `/bots corp inviteall cancel` for authorized corporation officers.
  Existing members stay in the corporation. If automatic recruitment is enabled,
  it pauses until a new manual run queues or Game restarts.
- Recruitment uses read-only character snapshots and waits one second before
  rechecking server load when a batch is paused.

# v0.2.152.4 (2026-11-22)
- Consolidated repeated per-cycle eligible bot ID array creation across six durable task claims.
- Updated overlay manifest for the changed source file, retaining exact old installed hash as previousNative.
- Updated atomic overlay installer for hash-validated upgrade + preserving the previous bytes if upgrade rolls back.
- Windows native and Ryzen multicore TCP variants retained. No bot AI, combat or corp recruitment settings changed.
# 0.2.152.9

- Repair portraits for offline and new bots in asynchronous, load-aware batches.
- Bundle pre-rendered JPEGs and reuse one saved portrait at every requested size.
- Preserve custom portraits and serve dashboard GET and HEAD from local files.
- Avoid character copies and unnecessary startup presence and work passes.

