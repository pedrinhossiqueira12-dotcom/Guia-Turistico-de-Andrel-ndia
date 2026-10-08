#!/usr/bin/env python3
"""Prepare a deterministic, OFFLINE Supabase migration release plan.

This tool never connects to Supabase or runs SQL. It does NOT authorize deployment.
The audited remote migration history must be checked again before any release.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"
MANIFEST = Path(__file__).with_name("release-migrations-manifest.json")
VALID_NAME = re.compile(r"^[0-9]{14}_[a-z0-9_]+\.sql$")


class PreflightError(Exception):
    pass


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def validate_plan(source=MIGRATIONS, manifest_path=MANIFEST):
    plan = json.loads(manifest_path.read_text(encoding="utf-8"))
    versions = plan["remote_versions"]
    aliases = plan["identical_migrations"]
    pending = plan["pending_migration"]

    if len(versions) != 28 or len(set(versions)) != 28 or versions != sorted(versions):
        raise PreflightError("Audited remote history must contain 28 distinct, ordered versions.")
    if not all(re.fullmatch(r"[0-9]{14}", v) for v in versions):
        raise PreflightError("Invalid remote version.")
    if len(aliases) != 3:
        raise PreflightError("All three existing financial migrations must be reconciled.")

    old_names, replacement_names, evidence = set(), set(), []
    for entry in aliases:
        old, new, expected_hash = entry["local"], entry["remote"], entry["sha256"]
        if not VALID_NAME.fullmatch(old) or not VALID_NAME.fullmatch(new):
            raise PreflightError("Malformed migration alias.")
        if old in old_names or new in replacement_names or new[:14] not in versions:
            raise PreflightError("Duplicate or unexpected financial migration alias.")
        if old.split("_", 1)[1] != new.split("_", 1)[1]:
            raise PreflightError("Changing SQL name and version together is prohibited.")
        path = source / old
        if not path.is_file():
            raise PreflightError(f"Missing audited migration: {old}")
        actual_hash = digest(path.read_bytes())
        if actual_hash != expected_hash:
            raise PreflightError(f"Already applied SQL changed: {old}")
        old_names.add(old)
        replacement_names.add(new)
        evidence.append({"source": old, "release": new, "sha256": actual_hash, "remote_applied": True})

    original, release = pending["local"], pending["release"]
    if not VALID_NAME.fullmatch(original) or not VALID_NAME.fullmatch(release):
        raise PreflightError("Malformed pending migration.")
    if release[:14] <= versions[-1] or release[:14] in versions:
        raise PreflightError("Pending release version must be strictly newer than remote history.")
    if original in old_names or release in replacement_names:
        raise PreflightError("Pending migration overlaps applied history.")

    files = sorted(x for x in source.glob("*.sql") if x.is_file())
    if len(files) != len(versions) + 1:
        raise PreflightError(f"Expected 29 SQL files, found {len(files)}.")
    mappings, release_versions = {}, []
    for file in files:
        name = file.name
        if not VALID_NAME.fullmatch(name):
            raise PreflightError(f"Invalid migration filename: {name}")
        if name in old_names:
            output_name = next(e["remote"] for e in aliases if e["local"] == name)
        elif name == original:
            output_name = release
        else:
            output_name = name
        mappings[name] = output_name
        release_versions.append(output_name[:14])
        if name not in old_names:
            evidence.append({
                "source": name,
                "release": output_name,
                "sha256": digest(file.read_bytes()),
                "remote_applied": name != original,
            })

    if len(set(mappings.values())) != len(mappings):
        raise PreflightError("Migration filename collision.")
    if sorted(release_versions) != sorted(versions + [release[:14]]):
        raise PreflightError("Release versions differ from audited remote history + ONE new migration.")
    if len([e for e in evidence if not e["remote_applied"]]) != 1:
        raise PreflightError("Release package may contain exactly one pending SQL migration.")

    return {
        "audited_date": plan["audited_utc_date"],
        "remote_history_versions": versions,
        "pending_release_version": release[:14],
        "pending_release_name": release,
        "file_count": len(mappings),
        "already_applied_count": len(versions),
        "pending_count": 1,
        "migrations": sorted(evidence, key=lambda e: e["release"]),
        "mappings": mappings,
    }


def prepare(target, evidence):
    target = target.resolve()
    if target == ROOT or target.is_relative_to(ROOT) or target == MIGRATIONS:
        raise PreflightError("Release output must be outside the Git working tree.")
    if target.exists():
        raise PreflightError("Refusing to overwrite an existing release directory.")
    target.mkdir(parents=True)
    output_dir = target / "supabase" / "migrations"
    output_dir.mkdir(parents=True)
    for old, new in evidence["mappings"].items():
        source = MIGRATIONS / old
        payload = source.read_bytes()
        (output_dir / new).write_bytes(payload)
    release_metadata = {key: value for key, value in evidence.items() if key != "mappings"}
    (target / "release-evidence.json").write_text(
        json.dumps(release_metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (target / "README.txt").write_text(
        "PLANO OFFLINE, NAO AUTORIZA PRODUCAO.\n"
        "Compare historico remoto ATUAL e hashes antes de aplicar.\n"
        "Um unico SQL pendente: " + evidence["pending_release_name"] + "\n"
        "Nao executar sobre staging vazio: migrations legadas podem conter cron/URLs de producao.\n"
        "Exigir backup real testado (PostgreSQL + Storage), sandbox e autorizacao.\n",
        encoding="utf-8",
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path,
        help="Write an offline, version-aligned package OUTSIDE the repository. Never deploys.",
    )
    args = parser.parse_args()
    try:
        result = validate_plan()
        if args.output is not None:
            prepare(args.output, result)
        print(json.dumps({
            "audited_date": result["audited_date"],
            "remote_history_count": result["already_applied_count"],
            "pending_count": result["pending_count"],
            "pending_filename": result["pending_release_name"],
            "version_alignments": len([k for k, v in result["mappings"].items() if k != v]),
            "output": str(args.output) if args.output is not None else None,
            "safe_to_deploy": False,
        }, ensure_ascii=False))
        return 0
    except (PreflightError, ValueError, KeyError, OSError) as error:
        print("MIGRATION PREFLIGHT FAILED: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
