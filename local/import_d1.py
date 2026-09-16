#!/usr/bin/env python3
"""Import a legacy D1 SQL export into the local history database."""

from __future__ import annotations

import sqlite3
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from server import DB_PATH, Store  # noqa: E402


def table_exists(connection: sqlite3.Connection, name: str) -> bool:
    return connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python3 local/import_d1.py /path/to/d1-export.sql")
    export_path = Path(sys.argv[1]).resolve()
    if not export_path.is_file():
        raise SystemExit(f"export not found: {export_path}")

    temporary = sqlite3.connect(":memory:")
    temporary.executescript(export_path.read_text())
    Store(DB_PATH)
    target = sqlite3.connect(DB_PATH)
    target.row_factory = sqlite3.Row
    imported = {"latency": 0, "gaps": 0, "outages": 0, "speedtests": 0}

    if table_exists(temporary, "latency_samples"):
        rows = temporary.execute("SELECT rowid, isp_id, recorded_at, https_latency_ms FROM latency_samples ORDER BY recorded_at ASC").fetchall()
        for row in rows:
            target.execute("INSERT OR IGNORE INTO beats (isp_id, boot_id, seq, probe_ts, received_at, flags, latency_ms) VALUES (?, 'imported', ?, ?, ?, 7, ?)", (row[1], row[0], row[2], row[2], row[3]))
            imported["latency"] += 1

    if table_exists(temporary, "heartbeat_gaps"):
        rows = temporary.execute("SELECT isp_id, started_at, ended_at, duration_seconds, reason FROM heartbeat_gaps").fetchall()
        for row in rows:
            target.execute("INSERT OR IGNORE INTO heartbeat_gaps (isp_id, started_at, ended_at, duration_seconds, reason) VALUES (?, ?, ?, ?, ?)", tuple(row))
            imported["gaps"] += 1

    if table_exists(temporary, "outage_events"):
        rows = temporary.execute("SELECT isp_id, started_at, ended_at, duration_seconds, reason FROM outage_events").fetchall()
        for row in rows:
            target.execute("INSERT INTO outages (isp_id, started_at, ended_at, duration_seconds, reason) VALUES (?, ?, ?, ?, ?)", tuple(row))
            imported["outages"] += 1

    if table_exists(temporary, "speedtest_results"):
        rows = temporary.execute("SELECT isp_id, source_result_id, recorded_at, download_mbps, upload_mbps, ping_ms, jitter_ms, packet_loss, server_name FROM speedtest_results").fetchall()
        for row in rows:
            payload = {
                "result_id": row[1], "recorded_at": row[2], "download_mbps": row[3], "upload_mbps": row[4],
                "ping_ms": row[5], "jitter_ms": row[6], "packet_loss": row[7], "server_name": row[8],
            }
            target.execute("INSERT OR IGNORE INTO speedtest_results (isp_id, result_id, recorded_at, payload_json) VALUES (?, ?, ?, ?)", (row[0], row[1], row[2], json.dumps(payload, separators=(",", ":"))))
            imported["speedtests"] += 1

    target.commit()
    target.close()
    print(imported)


if __name__ == "__main__":
    main()
