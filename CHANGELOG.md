# Changelog

Newest first. The Docker add-on keeps the upstream version number (0.2.152);
the Windows launcher package adds a fourth number for its own releases.

## Unreleased: housekeeping

On the `housekeeping` branch of the ubermidas fork, not yet offered upstream.
Docker add-on 0.2.152, Windows package 0.2.152.12.

### Faster under load

- Ranking idle pilots for work no longer copies every structure in the
  universe for each pilot, or builds a game session for every pilot just to
  check its corporation role. Both answers now come from 30-second caches.
- A corporation without a headquarters looks for a structure to buy at most
  once a minute per manager, instead of searching the market on every pass.
- Bots in a fight no longer force a disk write every second. Their combat
  notes are saved with the store's normal batching; the store is written at
  once only when a fight decision changes.
- Local defense skips two hit-point estimates it never used, and builds a
  ship-fit snapshot only when a responder engages.
- Fleet attack, fleet follow, mining escorts, industry cycles and supply
  checks look a bot up by ID instead of rebuilding the whole roster each step.

### Fixes

- Pilots outside the planetary collection group now collect their own
  launches once they are three days old, so older colonies no longer lose
  output when a launch decays after five days.
- A module's capacitor use is counted once per cycle, not once per
  activation effect.

### Easier to install and run

- One command installs or upgrades: `python3 install.py /path/to/evejs --start`.
  It rebuilds, starts the server, waits until it is healthy, then starts the
  bots.
- Upgrades no longer stop on files the previous Playerbots install wrote.
  Only files changed by hand need `--replace-conflicts`.
- New `addons/playerbots/playerbots.py` for start, stop, restart, rebuild,
  status and logs, in the right order every time. Launcher and Server Panel
  setups give their extra Compose files once, at install.
- Tests that need a full EveJS checkout report as skipped instead of failing.

### Documentation

- 29 Markdown files are now 7: README (overview and quick start), GUIDE
  (the operator's handbook), CHANGELOG, CONTRIBUTING, the Windows package
  README and the license notices. The old roadmap and dated test logs stay in
  git history.
- The Windows package upgrades 0.2.152.10 and 0.2.152.11 installs in place.

## Fork changes, 22–23 Nov 2026 (Windows 0.2.152.11)

By [@ubermidas](https://github.com/ubermidas), built for a local server.

- **New dashboard.** Six pages instead of ten. **Activity** shows what every
  bot is doing and why idle ones are idle. A **pilot panel** gives per-pilot
  orders, and a **Corporations** page commands whole corporations or chosen
  pilots. Errors are in plain words, and the dashboard asks for a server
  rebuild when it is newer than the server.
- **Orders survive restarts.** Corporation recall and work orders, from the
  dashboard or `/bots corp`, are re-issued about a minute after start-up.
- **Dashboard on 127.0.0.1 by default**, since it can command bots without a
  login. `/bots corp help` lists every corporation command.
- **Built-in Guide page** on the dashboard: plain-language topics, worked
  examples and a searchable command list with copy buttons.
- **Headquarters upkeep.** A structure caretaker fuels and powers structures
  before mining around headquarters. Every cored structure the corporation
  owns is maintained, headquarters first, and new headquarters get a
  generated name.
- **Sci-fi corporation names and emblems.** New bot corporations take an
  unused famous sci-fi company name with a unique ticker, and a random emblem
  from the game's logo shapes. Turn off with `SCIFI_CORPORATION_NAMES=0` and
  `CORPORATION_EMBLEMS=0`.
- **Installer cleanup.** Files an older release left behind move into the
  install backup, and rollback puts them back.

Known limits:

- `/playerbots resume` in chat does not release a pilot from a corporation
  recall; after a restart it is recalled again. The dashboard's **Resume**
  does release it.
- A recall that times out after 6 hours is re-issued after the next restart
  unless you cancel it on the corporation page.

## Corporation headquarters priority (merged upstream as PR #14)

- A bot corporation with no dockable structure buys, hauls and anchors an
  Upwell headquarters before other work. That headquarters becomes its
  mining base and deposit depot.
- Planetary work became background work: about 1 pilot in 8 collects
  launches and 1 in 20 sets up colonies.
- Customs inspection cases are saved one row at a time.

## Luna update by @rizonx (Windows 0.2.152.10)

Merged into the fork, so it ships with both the Docker add-on and the
Windows package.

- **Corporation recruitment:** `/bots corp inviteall [status|cancel]` and
  optional automatic recruitment into a chosen player corporation, with
  member and bot limits.
- **Corporation income:** player-led corporations get 60% of their bots' net
  profit (was 40%); bot-led corporations get 20% of each profitable job (was
  10%), with a minimum payout.
- **Portrait repair:** 32 bundled portraits, a one-time refresh of existing
  bots with their old portraits backed up, and background repair of missing
  ones.
- **Performance:** buffered combat progress and profit saves, task claims and
  bot lookups without full-roster scans, cheaper corporation membership
  counts.
- **Windows launcher package:** install, disable, remove and recover from
  EVEJS Launcher, with the multicore TCP build detected automatically.

## Earlier Windows package releases

- **0.2.152.9:** portraits repaired for offline and new bots in load-aware
  batches; bundled JPEGs reused at every size; custom portraits kept; fewer
  start-up passes.
- **0.2.152.7:** buffered combat progression saves. A pending tier and its
  duplicate-site checks show at once, and storage updates about once a minute
  and at graceful shutdown.
- **0.2.152.6:** `/bots corp inviteall cancel` for corporation officers.
  Automatic recruitment pauses until the next manual run or Game restart.
  Recruitment waits a second before rechecking load when a batch is paused.
- **0.2.152.4:** shared eligible-bot lists across six task claims; an atomic,
  hash-checked overlay upgrade that restores the previous bytes if it rolls
  back.

## 0.2.152 and earlier

See the git history and the upstream repository,
[kroryan/evejs-playerbots-addon](https://github.com/kroryan/evejs-playerbots-addon).
The former `PLAYERBOTS_ROADMAP.md`, `PLAYERBOTS_CAPACITY_MODEL.md` and native
validation notes, with their dated test evidence, are in the history before
this release.
