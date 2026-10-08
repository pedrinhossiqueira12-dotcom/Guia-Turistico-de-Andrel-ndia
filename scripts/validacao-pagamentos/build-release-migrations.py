#!/usr/bin/env python3
"""Build OFFLINE manifest of already-applied migrations aligned with live Supabase.

Do not deploy or apply SQL. This plan contains ZERO unapplied migrations.
The database is the source of truth; recheck live versions before future changes.
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


def applied_sql_bytes(raw):
    """The Supabase MCP applied the audited DDL without BEGIN/COMMIT wrappers."""
    source = raw.decode("utf-8")
    body = re.sub(r"\nBEGIN;\s*\n", "\n", source, count=1)
    body = re.sub(r"\nCOMMIT;\s*$", "\n", body, count=1)
    if body == source or re.search(r"(?m)^\s*(BEGIN|COMMIT);", body):
        raise PreflightError("Unexpected transaction wrappers in deployed financial SQL")
    return body.encode("utf-8")


def validate_plan(source=MIGRATIONS, manifest_path=MANIFEST):
    plan = json.loads(manifest_path.read_text(encoding="utf-8"))
    versions = plan["remote_versions"]
    aliases = plan["identical_migrations"]
    applied = plan["applied_adjusted_migration"]
    if "pending_migration" in plan:
        raise PreflightError("Stale manifest still contains pending migration")
    if len(versions) != 29 or len(set(versions)) != 29 or versions != sorted(versions):
        raise PreflightError("Audited remote history must contain 29 distinct, ordered versions.")
    if not all(re.fullmatch(r"[0-9]{14}", v) for v in versions):
        raise PreflightError("Invalid remote version.")
    if len(aliases) != 3:
        raise PreflightError("All three earlier migration aliases are required.")
    old_names, replacement_names, evidence = set(), set(), []
    for entry in aliases:
        old, new, expected_hash = entry["local"], entry["remote"], entry["sha256"]
        if not VALID_NAME.fullmatch(old) or not VALID_NAME.fullmatch(new):
            raise PreflightError("Malformed migration alias.")
        if old in old_names or new in replacement_names or new[:14] not in versions:
            raise PreflightError("Duplicate or unrecognized remote migration version.")
        if old.split("_", 1)[1] != new.split("_", 1)[1]:
            raise PreflightError("Historical migration name was changed.")
        path = source / old
        if not path.is_file() or digest(path.read_bytes()) != expected_hash:
            raise PreflightError(f"Already applied SQL changed: {old}")
        old_names.add(old)
        replacement_names.add(new)
        evidence.append({"source": old, "release": new, "sha256": expected_hash, "remote_applied": True})

    local, remote = applied["local"], applied["remote"]
    if not VALID_NAME.fullmatch(local) or not VALID_NAME.fullmatch(remote):
        raise PreflightError("Malformed adjusted migration.")
    if applied["transformation"] != "strip_transaction_wrappers":
        raise PreflightError("Unrecognized migration normalization")
    if remote[:14] != versions[-1] or remote in replacement_names or local in old_names:
        raise PreflightError("Adjusted migration must match the last applied version.")
    if not (source / local).is_file():
        raise PreflightError(f"Missing final SQL: {local}")
    if digest(applied_sql_bytes((source / local).read_bytes())) != applied["sha256"]:
        raise PreflightError("Applied final SQL changed; remote hash does not match.")
    old_names.add(local)
    replacement_names.add(remote)
    evidence.append({"source": local, "release": remote,
                     "sha256": applied["sha256"], "remote_applied": True})

    files = sorted(x for x in source.glob("*.sql") if x.is_file())
    if len(files) != 29:
        raise PreflightError(f"Expected 29 SQL files, found {len(files)}.")
    mappings, release_versions = {}, []
    for file in files:
        name = file.name
        if not VALID_NAME.fullmatch(name):
            raise PreflightError(f"Invalid migration filename: {name}")
        if name in old_names:
            output_name = next((e["remote"] for e in aliases if e["local"] == name), remote)
        else:
            output_name = name
            evidence.append({"source": name, "release": name,
                             "sha256": digest(file.read_bytes()), "remote_applied": True})
        mappings[name] = output_name
        release_versions.append(output_name[:14])

    if len(set(mappings.values())) != len(mappings):
        raise PreflightError("Migration filename collision.")
    if sorted(release_versions) != versions:
        raise PreflightError("Release versions do not match all 29 APPLIED database versions.")
    if len(evidence) != 29 or any(not e["remote_applied"] for e in evidence):
        raise PreflightError("Must contain exactly 29 already-applied migrations and ZERO pending.")

    return {
        "audited_date": plan["audited_utc_date"],
        "remote_history_versions": versions,
        "pending_release_version": None,
        "pending_release_name": None,
        "file_count": 29,
        "already_applied_count": 29,
        "pending_count": 0,
        "migrations": sorted(evidence, key=lambda e: e["release"]),
        "mappings": mappings,
        "normalized_local": local,
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
        payload = (MIGRATIONS / old).read_bytes()
        if old == evidence["normalized_local"]:
            payload = applied_sql_bytes(payload)
        (output_dir / new).write_bytes(payload)
    release_metadata = {k: v for k, v in evidence.items() if k not in ("mappings", "normalized_local")}
    (target / "release-evidence.json").write_text(
        json.dumps(release_metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (target / "README.txt").write_text(
        "HISTORICO DE 29 MIGRATIONS JA APLICADAS; ZERO SQL PENDENTE.\n"
        "NUNCA executar estas migrations novamente em producao.\n"
        "Para migrations futuras: revalidar banco atual, ambiente, hash e nova versao.\n"
        "O pacote e somente para conferir a identidade do historico remoto.\n",
        encoding="utf-8",
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write an offline comparison package outside repo.")
    args = parser.parse_args()
    try:
        result = validate_plan()
        if args.output is not None:
            prepare(args.output, result)
        print(json.dumps({
            "audited_date": result["audited_date"],
            "remote_history_count": result["already_applied_count"],
            "pending_count": result["pending_count"],
            "pending_filename": None,
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
