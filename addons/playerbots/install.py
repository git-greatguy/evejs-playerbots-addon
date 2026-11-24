#!/usr/bin/env python3
"""Version-pinned installer for the EveJS playerbots add-on bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent
INTEGRATION_ROOT = PACKAGE_ROOT / "integration" / "server"
ADDON_SOURCE = PACKAGE_ROOT / "addons" / "playerbots"
OVERRIDE_SOURCE = PACKAGE_ROOT / "compose.override.yaml"
STATE_NAME = ".playerbots-install-state.json"
# Add-on files earlier releases installed that this release no longer ships.
# They are moved into the install backup (rollback puts them back) so an
# upgrade does not leave stale files behind. The guides now ship only with the
# package and the repository, not inside the EveJS folder.
OBSOLETE_ADDON_FILES = (
    "addons/playerbots/dashboard/app.js",
    "addons/playerbots/README.md",
    "addons/playerbots/GUIDE.md",
    "addons/playerbots/INSTALLATION.md",
    "addons/playerbots/OPERATIONS.md",
    "addons/playerbots/TROUBLESHOOTING.md",
    "addons/playerbots/LOCAL_DEFENSE.md",
)
# Package-level tools that are not copied into the EveJS folder.
PACKAGE_ONLY_FILES = {
    "addons/playerbots/install.sh",
    "addons/playerbots/install.py",
    "addons/playerbots/rollback.py",
    "addons/playerbots/verify.py",
    "addons/playerbots/compose.override.yaml",
}

# playerbots.py (start, stop, status) ships in addons/playerbots; the
# installer shares its Compose helpers.
sys.path.insert(0, str(ADDON_SOURCE))
sys.path.insert(0, str(PACKAGE_ROOT))
import playerbots as ops  # noqa: E402


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest() -> dict:
    path = PACKAGE_ROOT / "integration" / "manifest.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"The ZIP integration manifest is missing or invalid: {error}") from error


def check_version(target: Path, expected: str) -> None:
    for relative in ("package.json", "server/package.json"):
        path = target / relative
        try:
            actual = json.loads(path.read_text(encoding="utf-8")).get("version")
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Cannot read {relative}: {error}") from error
        if actual != expected:
            raise RuntimeError(f"Unsupported EveJS source version in {relative}: expected {expected}, found {actual!r}.")


def validate_target(target: Path, manifest: dict, replace_conflicts: bool = False,
                    settings: dict | None = None) -> tuple[list[str], list[str]]:
    settings = settings or ops.compose_settings(target)
    if not (target / "docker/entrypoint.sh").is_file():
        raise RuntimeError(f"{target} is not an EveJS source folder (docker/entrypoint.sh is missing).")
    if not (target / settings["baseFile"]).is_file():
        raise RuntimeError(f"{target} has no {settings['baseFile']}. Pass --base-compose for a non-standard Compose setup.")
    check_version(target, str(manifest["evejsVersion"]))
    # Files this installer wrote last time are an ordinary upgrade, not a
    # conflict. Only files changed by hand since then need a decision.
    previous = ops.read_state(target).get("installedSha256") or {}
    conflicts = []
    for relative, record in manifest["files"].items():
        source = INTEGRATION_ROOT / relative
        if not source.is_file():
            raise RuntimeError(f"The package integration source is missing: {relative}.")
        source_hash = sha256(source)
        if source_hash != record.get("sourceSha256") or source_hash != record.get("overlaySha256"):
            raise RuntimeError(f"The package source/overlay checksum failed: {relative}.")
        destination = target / relative
        if destination.exists():
            current = sha256(destination)
            if current not in {record.get("baseSha256"), record["overlaySha256"], previous.get(relative)}:
                conflicts.append(relative)
        elif record.get("baseSha256") is not None:
            conflicts.append(relative)
    if conflicts and not replace_conflicts:
        sample = ", ".join(conflicts[:8])
        more = "" if len(conflicts) <= 8 else f" and {len(conflicts) - 8} more"
        raise RuntimeError(
            "These server files match neither stock EveJS nor the last Playerbots install "
            f"(changed by hand, or missing): {sample}{more}. No files were changed. Review them, then rerun with --replace-conflicts; "
            "the installer backs up each file and rollback.py can restore it."
        )
    return list(manifest["files"]), conflicts


def preflight_compose(target: Path, settings: dict) -> None:
    command = ops.compose_command(target, settings, "config", "--quiet")
    # Before installing, the override is not in the EveJS folder yet; check
    # the package's copy in its place.
    command[command.index(ops.OVERRIDE)] = str(OVERRIDE_SOURCE)
    subprocess.run(command, cwd=target, check=True)


def update_env(path: Path) -> tuple[bool, bool, bool]:
    existed = path.exists()
    original_mode = path.stat().st_mode & 0o777 if existed else None
    lines = path.read_text(encoding="utf-8").splitlines() if existed else []
    keys = {
        "EVEJS_PLAYER_BOTS_ADDON_TOKEN",
        "EVEJS_PLAYER_BOTS_ADDON_MODE",
    }
    values: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        if key.strip() in keys:
            values[key.strip()] = value.strip().strip("\"'")

    token = values.get("EVEJS_PLAYER_BOTS_ADDON_TOKEN", "")
    token_created = len(token) < 32
    if token_created:
        values["EVEJS_PLAYER_BOTS_ADDON_TOKEN"] = secrets.token_hex(32)
    mode_created = "EVEJS_PLAYER_BOTS_ADDON_MODE" not in values
    if mode_created:
        values["EVEJS_PLAYER_BOTS_ADDON_MODE"] = "auto"

    output = []
    emitted: set[str] = set()
    for line in lines:
        stripped = line.strip()
        key = stripped.split("=", 1)[0].strip() if "=" in stripped and not stripped.startswith("#") else ""
        if key == "EVEJS_PLAYER_BOTS_DASHBOARD_PASSWORD":
            continue
        if key in values:
            if key not in emitted:
                output.append(f"{key}={values[key]}")
                emitted.add(key)
        else:
            output.append(line)
    for key in keys:
        if key not in emitted:
            output.append(f"{key}={values[key]}")
    path.write_text("\n".join(output) + "\n", encoding="utf-8")
    if os.name != "nt":
        path.chmod(0o600)
    return token_created, mode_created


def install(target: Path, overlay_files: list[str], settings: dict, version: str = "") -> tuple[Path, list[str]]:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    backup = target / f".playerbots-install-backup-{stamp}"
    backup.mkdir(mode=0o700)
    managed: list[str] = []
    existed: list[str] = []
    removed: list[str] = []

    def copy_managed(source: Path, relative: str) -> None:
        destination = target / relative
        backup_path = backup / relative
        if destination.is_file():
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destination, backup_path)
            existed.append(relative)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        managed.append(relative)

    try:
        for relative in overlay_files:
            copy_managed(INTEGRATION_ROOT / relative, relative)

        for source in sorted(ADDON_SOURCE.rglob("*")):
            if not source.is_file() or "__pycache__" in source.parts or source.suffix == ".pyc":
                continue
            relative = source.relative_to(PACKAGE_ROOT).as_posix()
            if relative in PACKAGE_ONLY_FILES:
                continue
            copy_managed(source, relative)
        copy_managed(OVERRIDE_SOURCE, "addons/playerbots/compose.override.yaml")

        for relative in OBSOLETE_ADDON_FILES:
            obsolete = target / relative
            if obsolete.is_file() and relative not in managed:
                backup_path = backup / relative
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(obsolete, backup_path)
                obsolete.unlink()
                removed.append(relative)

        env_path = target / ".env"
        env_existed = env_path.is_file()
        if env_existed:
            shutil.copy2(env_path, backup / ".env")
            existed.append(".env")
        token_created, mode_created = update_env(env_path)
        managed.append(".env")

        state = {
            "installedAt": datetime.now(timezone.utc).isoformat(),
            "addonVersion": version,
            "compose": settings,
            "backupDirectory": backup.name,
            "managedFiles": managed,
            "installedSha256": {relative: sha256(target / relative) for relative in managed},
            "preExistingFiles": existed,
            "removedFiles": removed,
            "envExisted": env_existed,
            "tokenCreated": token_created,
            "modeCreated": mode_created,
        }
        state_path = target / STATE_NAME
        state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        if os.name != "nt":
            state_path.chmod(0o600)

        ops.run(target, settings, "config", "--quiet")
        return backup, removed
    except Exception:
        for relative in removed:
            saved = backup / relative
            if saved.is_file():
                (target / relative).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(saved, target / relative)
        for relative in reversed(managed):
            destination = target / relative
            saved = backup / relative
            if saved.is_file():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(saved, destination)
            elif destination.is_file():
                destination.unlink()
        state_path = target / STATE_NAME
        if state_path.is_file():
            state_path.unlink()
        raise


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install or upgrade the EveJS Playerbots add-on. Re-run the same command to upgrade.")
    parser.add_argument("target", nargs="?", default=".", help="EveJS source folder (default: current folder)")
    parser.add_argument("--start", action="store_true",
                        help="after installing, rebuild the EveJS image, start the server, wait until it is healthy, then start the bots")
    parser.add_argument("--dry-run", action="store_true", help="check everything and change nothing")
    parser.add_argument(
        "--replace-conflicts",
        action="store_true",
        help="replace server files that were changed by hand, after backing them up",
    )
    parser.add_argument("--base-compose", help="base Compose file, relative to the EveJS folder (default: compose.yaml)")
    parser.add_argument("--compose-file", action="append", default=[], dest="compose_files",
                        help="extra Compose file your setup uses, such as a launcher's (repeatable)")
    parser.add_argument("--project-name", help="Compose project name, for setups that use one")
    parser.add_argument("--env-file", help="Compose env file, for setups that keep it outside the EveJS folder")
    parser.add_argument("--wait-timeout", type=int, default=ops.DEFAULT_WAIT_SECONDS,
                        help="with --start: seconds to wait for the server to become healthy (default 600)")
    arguments = parser.parse_args()

    target = Path(arguments.target).expanduser().resolve()
    # Settings given now are remembered for playerbots.py and later upgrades.
    settings = ops.compose_settings(target, {
        "baseFile": arguments.base_compose,
        "extraFiles": arguments.compose_files,
        "projectName": arguments.project_name,
        "envFile": arguments.env_file,
    })
    try:
        manifest = load_manifest()
        version = ""
        try:
            version = str(json.loads((ADDON_SOURCE / "manifest.json").read_text(encoding="utf-8")).get("version") or "")
        except (OSError, json.JSONDecodeError):
            version = ""
        overlay_files, conflicts = validate_target(target, manifest, arguments.replace_conflicts, settings)
        preflight_compose(target, settings)
        if arguments.dry_run:
            note = f"; {len(conflicts)} changed or missing server files would be backed up and replaced" if conflicts else ""
            print(f"Dry run passed for EveJS {manifest['evejsVersion']} at {target}{note}. Nothing was changed.")
            return 0

        backup, removed = install(target, overlay_files, settings, version)
        print(f"Playerbots {version} installed for EveJS {manifest['evejsVersion']}.".replace("  ", " "))
        if conflicts:
            print(f"Replaced {len(conflicts)} changed or missing server files; the old ones are in the backup.")
        if removed:
            print(f"Moved {len(removed)} file(s) this release no longer uses into the backup.")
        print(f"Backup of every replaced file: {backup}")
        print("The game database was not touched.")
        if arguments.start:
            ops.run(target, settings, "stop", "playerbots-addon", check=False)
            ops.run(target, settings, "build", "init")
            ops.start(target, settings, arguments.wait_timeout, recreate=True)
        else:
            print("Nothing was started. To build and start, run from the EveJS folder:")
            print("  python3 addons/playerbots/playerbots.py rebuild")
        return 0
    except FileNotFoundError as error:
        if getattr(error, "filename", None) == "docker":
            print("Installation stopped: Docker was not found. Install Docker with the Compose plugin.", file=sys.stderr)
        else:
            print(f"Installation stopped: {error}", file=sys.stderr)
        return 2
    except (OSError, RuntimeError, subprocess.CalledProcessError, KeyError) as error:
        print(f"Installation stopped: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
