#!/usr/bin/env python3
"""Start, stop and check the Playerbots services of a Docker Compose EveJS server.

Every command uses the Compose files, project name and env file that install.py
recorded for that EveJS folder, so the long `docker compose -f ... -f ...`
lines never have to be typed by hand. It always starts the EveJS server first,
waits until it reports healthy, and only then starts the bots.

    python3 playerbots.py start   [EVEJS_DIR]   start the server, then the bots
    python3 playerbots.py stop    [EVEJS_DIR]   stop the bots; the server stays up
    python3 playerbots.py stop --all            stop the bots and the server
    python3 playerbots.py restart [EVEJS_DIR]   restart the server cleanly, then the bots
    python3 playerbots.py restart --bots-only   recreate only the bots, e.g. after editing .env
    python3 playerbots.py rebuild [EVEJS_DIR]   rebuild the image after an update, then restart
    python3 playerbots.py status  [EVEJS_DIR]   show Market, server and bot state
    python3 playerbots.py logs    [EVEJS_DIR]   last log lines (-f to follow, --server for EveJS)

EVEJS_DIR defaults to the current folder. Market is never started or stopped.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

STATE_NAME = ".playerbots-install-state.json"
OVERRIDE = "addons/playerbots/compose.override.yaml"
DEFAULT_WAIT_SECONDS = 600
DASHBOARD_URL = "http://127.0.0.1:8080"


def read_state(target: Path) -> dict:
    path = target / STATE_NAME
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def compose_settings(target: Path, overrides: dict | None = None) -> dict:
    """The Compose files and project for this folder: what the caller passed,
    else what the last install recorded, else the plain EveJS defaults."""
    saved = read_state(target).get("compose") or {}
    overrides = {key: value for key, value in (overrides or {}).items() if value}
    settings = {
        "baseFile": saved.get("baseFile") or "compose.yaml",
        "extraFiles": list(saved.get("extraFiles") or []),
        "projectName": saved.get("projectName") or "",
        "envFile": saved.get("envFile") or "",
    }
    settings.update(overrides)
    return settings


def compose_command(target: Path, settings: dict, *arguments: str) -> list[str]:
    command = ["docker", "compose"]
    if settings.get("projectName"):
        command += ["--project-name", settings["projectName"]]
    if settings.get("envFile"):
        command += ["--env-file", str(settings["envFile"])]
    for file in [settings["baseFile"], *settings.get("extraFiles", []), OVERRIDE]:
        command += ["-f", str(file)]
    return command + list(arguments)


def run(target: Path, settings: dict, *arguments: str, check: bool = True,
        capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        compose_command(target, settings, *arguments),
        cwd=target, check=check, text=True,
        stdout=subprocess.PIPE if capture else None,
    )


def service_state(target: Path, settings: dict, service: str) -> dict:
    """{"state": "running"|"exited"|..., "health": "healthy"|"starting"|""}, or
    {} when the service has no container. Handles both the JSON-array and the
    JSON-lines output of different Compose versions."""
    result = run(target, settings, "ps", "--all", "--format", "json", service, check=False, capture=True)
    text = (result.stdout or "").strip()
    if result.returncode != 0 or not text:
        return {}
    try:
        rows = json.loads(text)
        rows = rows if isinstance(rows, list) else [rows]
    except json.JSONDecodeError:
        rows = []
        for line in text.splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    for row in rows:
        if str(row.get("Service") or "") in ("", service):
            return {"state": str(row.get("State") or "").lower(), "health": str(row.get("Health") or "").lower()}
    return {}


def wait_until_healthy(target: Path, settings: dict, service: str = "server",
                       timeout: int = DEFAULT_WAIT_SECONDS, sleep=time.sleep, clock=time.monotonic) -> None:
    deadline = clock() + timeout
    print(f"Waiting for {service} to report healthy (up to {timeout // 60} min)...", flush=True)
    while True:
        state = service_state(target, settings, service)
        if state.get("health") == "healthy" or (state.get("state") == "running" and not state.get("health")):
            print(f"{service} is healthy.", flush=True)
            return
        if state.get("health") == "unhealthy" or state.get("state") in ("exited", "dead"):
            raise RuntimeError(f"{service} stopped or became unhealthy. Check: python3 playerbots.py logs --server")
        if clock() >= deadline:
            raise RuntimeError(f"{service} was not healthy after {timeout} seconds. Check: python3 playerbots.py logs --server")
        sleep(5)


def warn_if_market_down(target: Path, settings: dict) -> None:
    state = service_state(target, settings, "market")
    if state.get("state") != "running":
        print("Note: the EveJS Market service is not running. Start it with EveJS's own tools first; "
              "bots that trade will wait until it is up.", flush=True)


def start(target: Path, settings: dict, timeout: int, recreate: bool = False) -> None:
    warn_if_market_down(target, settings)
    extra = ["--force-recreate"] if recreate else []
    run(target, settings, "up", "-d", "--no-deps", *extra, "server")
    wait_until_healthy(target, settings, "server", timeout)
    run(target, settings, "up", "-d", "--no-deps", *extra, "playerbots-addon")
    print(f"Playerbots is running. Dashboard: {DASHBOARD_URL}", flush=True)


def resolve_target(given: str) -> Path:
    """The EveJS folder: the one given, else the current folder, else the
    folder this script was installed into (EVEJS/addons/playerbots/)."""
    target = Path(given).expanduser().resolve()
    if given != "." or (target / OVERRIDE).is_file():
        return target
    installed_in = Path(__file__).resolve().parents[2]
    return installed_in if (installed_in / OVERRIDE).is_file() else target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Start, stop and check Playerbots on a Docker Compose EveJS server.")
    parser.add_argument("command", choices=["start", "stop", "restart", "rebuild", "status", "logs"])
    parser.add_argument("target", nargs="?", default=".", help="EveJS folder (default: current folder)")
    parser.add_argument("--all", action="store_true", help="stop: also stop the EveJS server")
    parser.add_argument("--bots-only", action="store_true",
                        help="restart: recreate only the bots container; the server keeps running")
    parser.add_argument("-f", "--follow", action="store_true", help="logs: keep following")
    parser.add_argument("--server", action="store_true", help="logs: show the EveJS server instead of the bots")
    parser.add_argument("--wait-timeout", type=int, default=DEFAULT_WAIT_SECONDS,
                        help="seconds to wait for the server to become healthy (default 600)")
    arguments = parser.parse_args(argv)
    target = resolve_target(arguments.target)
    settings = compose_settings(target)
    try:
        if not (target / OVERRIDE).is_file():
            raise RuntimeError(f"Playerbots is not installed in {target}. Run install.py first.")
        if arguments.command == "start":
            start(target, settings, arguments.wait_timeout)
        elif arguments.command == "stop":
            run(target, settings, "stop", "playerbots-addon")
            if arguments.all:
                run(target, settings, "stop", "server")
            print("Stopped the bots." + (" Stopped the server." if arguments.all else " The server is still up for players."))
        elif arguments.command == "restart" and arguments.bots_only:
            run(target, settings, "up", "-d", "--no-deps", "--force-recreate", "playerbots-addon")
            print(f"Recreated the bots container. Dashboard: {DASHBOARD_URL}")
        elif arguments.command == "restart":
            run(target, settings, "stop", "playerbots-addon")
            run(target, settings, "restart", "server")
            wait_until_healthy(target, settings, "server", arguments.wait_timeout)
            run(target, settings, "up", "-d", "--no-deps", "playerbots-addon")
            print(f"Restarted. Dashboard: {DASHBOARD_URL}")
        elif arguments.command == "rebuild":
            run(target, settings, "stop", "playerbots-addon")
            run(target, settings, "build", "init")
            start(target, settings, arguments.wait_timeout, recreate=True)
        elif arguments.command == "status":
            run(target, settings, "ps", "--all", "market", "server", "playerbots-addon")
        elif arguments.command == "logs":
            service = "server" if arguments.server else "playerbots-addon"
            run(target, settings, "logs", "--tail", "100", *(["-f"] if arguments.follow else []), service, check=False)
        return 0
    except FileNotFoundError:
        print("Docker was not found. Install Docker with the Compose plugin and try again.", file=sys.stderr)
        return 2
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Stopped: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
