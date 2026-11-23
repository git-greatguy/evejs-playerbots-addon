#!/usr/bin/env python3
"""Build the Windows EVEJS Launcher package from this repository.

The launcher package installs the same server files as the Docker add-on, plus
the native driver (server/playerbots-native) that runs the add-on as a worker
thread inside the EveJS server. Its helper.cjs replaces each file only when
the installed bytes match the stock EveJS file, the current package, or an
earlier package release, so overlay.json carries the hashes of every earlier
release kept in windows-native/history.

    python tools/playerbots/build-windows-native.py            # writes dist/
    python tools/playerbots/build-windows-native.py --out DIR  # somewhere else
    python tools/playerbots/build-windows-native.py --unpacked DIR  # folder only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
NATIVE = REPO / "windows-native"
ADDON = REPO / "addons" / "playerbots"
OVERLAY = REPO / "integration" / "server"
MANIFEST = REPO / "integration" / "manifest.json"
PACKAGE_DIR = "evejs-playerbots-native"
NATIVE_PREFIX = "server/playerbots-native"
DOCS = (
    "GUIDE.md",
    "LOCAL_DEFENSE.md",
    "COMMUNITY_FITTINGS.md",
    "PLAYERBOTS_CAPACITY_MODEL.md",
    "THIRD_PARTY_NOTICES.md",
    "DASHBOARD_PATCH_NOTES.md",
    "LICENSE",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def load_history() -> list[dict]:
    """Released overlay.json files, newest first."""
    def key(path: Path) -> tuple[int, ...]:
        version = path.stem.removeprefix("overlay-")
        return tuple(int(part) for part in version.split("."))
    files = sorted((NATIVE / "history").glob("overlay-*.json"), key=key, reverse=True)
    return [json.loads(path.read_text(encoding="utf-8")) for path in files]


def earlier_hashes(relative: str, history: list[dict]) -> list[str]:
    """Hashes earlier releases installed for this file, newest first."""
    seen: list[str] = []
    for overlay in history:
        entry = overlay["files"].get(relative)
        if not entry:
            continue
        for digest in [entry.get("native"), entry.get("previousNative"), *(entry.get("olderNative") or [])]:
            if digest and digest not in seen:
                seen.append(digest)
    return seen


def stage_payload(payload: Path, manifest: dict) -> dict[str, str | None]:
    """Copy every server file into payload/ and return each one's stock hash."""
    stock: dict[str, str | None] = {}
    for relative, record in manifest["files"].items():
        if not relative.startswith("server/"):
            continue  # Docker-only files such as .dockerignore
        copy(OVERLAY / relative, payload / relative)
        stock[relative] = record.get("baseSha256")
    native_files = {
        f"{NATIVE_PREFIX}/native.cjs": NATIVE / "native" / "native.cjs",
        f"{NATIVE_PREFIX}/settings.json": NATIVE / "native" / "settings.json",
        f"{NATIVE_PREFIX}/index.js": ADDON / "index.js",
        f"{NATIVE_PREFIX}/dashboard-server.js": ADDON / "dashboard-server.js",
    }
    for path in sorted((ADDON / "dashboard").rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts:
            native_files[f"{NATIVE_PREFIX}/dashboard/{path.relative_to(ADDON / 'dashboard').as_posix()}"] = path
    # Files only earlier releases used. They stay listed so Disable removes them.
    for path in sorted((NATIVE / "legacy").rglob("*")):
        if path.is_file():
            native_files.setdefault(path.relative_to(NATIVE / "legacy").as_posix(), path)
    for relative, source in native_files.items():
        if relative in stock:
            raise SystemExit(f"{relative} is both a server overlay file and a native file.")
        copy(source, payload / relative)
        stock[relative] = None
    return stock


def build_overlay(payload: Path, stock: dict[str, str | None], history: list[dict], manifest: dict) -> dict:
    newest = history[0] if history else {"files": {}}
    files = {}
    for relative in sorted(stock):
        native = sha256(payload / relative)
        entry: dict = {"stock": stock[relative], "native": native}
        previous = [digest for digest in earlier_hashes(relative, history) if digest not in (native, stock[relative])]
        if previous:
            entry["previousNative"] = previous[0]
        if len(previous) > 1:
            entry["olderNative"] = previous[1:]
        # A stock file newly managed after an earlier release (or flagged so by
        # one) may be backed up during an upgrade, once its bytes are verified.
        adopted = any(overlay["files"].get(relative, {}).get("adoptVerifiedStock") for overlay in history)
        if stock[relative] is not None and history and (adopted or relative not in newest["files"]):
            entry["adoptVerifiedStock"] = True
        files[relative] = entry
    multicore = newest.get("multicore")
    if not multicore:
        raise SystemExit("windows-native/history has no multicore section to carry forward.")
    return {"schema": 1, "version": manifest["evejsVersion"], "files": files, "multicore": multicore}


def verify(package: Path, overlay: dict) -> None:
    for relative, entry in overlay["files"].items():
        if sha256(package / "payload" / relative) != entry["native"]:
            raise SystemExit(f"Payload hash mismatch: {relative}")
    tcp = package / "multicore" / "server" / "src" / "network" / "tcp" / "index.js"
    if sha256(tcp) != overlay["multicore"]["tcp"]["native"]:
        raise SystemExit("Multicore TCP file does not match its recorded hash.")
    settings = json.loads((package / "payload" / NATIVE_PREFIX / "settings.json").read_text(encoding="utf-8"))
    fields = {field["id"] for field in json.loads((package / "evejs-launcher.mod.json").read_text(encoding="utf-8"))["settings"]["fields"]}
    if set(settings) != fields:
        raise SystemExit(f"Launcher fields and settings.json differ: {sorted(set(settings) ^ fields)}")


def build(package: Path) -> dict:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    history = load_history()
    for name in ("evejs-launcher.mod.json", "helper.cjs", "README.md", "CHANGELOG.md"):
        copy(NATIVE / name, package / name)
    for name in DOCS:
        copy(REPO / name, package / name)
    copy(NATIVE / "multicore" / "server" / "src" / "network" / "tcp" / "index.js",
         package / "multicore" / "server" / "src" / "network" / "tcp" / "index.js")
    stock = stage_payload(package / "payload", manifest)
    overlay = build_overlay(package / "payload", stock, history, manifest)
    (package / "overlay.json").write_text(json.dumps(overlay, indent=2) + "\n", encoding="utf-8")
    verify(package, overlay)
    return overlay


def write_zip(package: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(package.rglob("*")):
            if path.is_file():
                info = zipfile.ZipInfo(f"{PACKAGE_DIR}/{path.relative_to(package).as_posix()}", (2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, path.read_bytes())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=REPO / "dist", help="folder for the ZIP (default: dist)")
    parser.add_argument("--unpacked", type=Path, help="write the unpacked package folder here instead of a ZIP")
    args = parser.parse_args()
    version = json.loads((NATIVE / "evejs-launcher.mod.json").read_text(encoding="utf-8"))["version"]
    if args.unpacked:
        if args.unpacked.exists() and any(args.unpacked.iterdir()):
            raise SystemExit(f"{args.unpacked} is not empty.")
        overlay = build(args.unpacked)
        print(f"Built {len(overlay['files'])} payload files into {args.unpacked}")
        return 0
    with tempfile.TemporaryDirectory() as temp:
        package = Path(temp) / PACKAGE_DIR
        overlay = build(package)
        target = args.out / f"evejs-playerbots-windows-v{version}.zip"
        write_zip(package, target)
    print(f"Built {target} ({len(overlay['files'])} payload files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
