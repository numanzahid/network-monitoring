#!/usr/bin/env python3
"""Small local history service for the monitoring probes and dashboard."""

from __future__ import annotations

import json
import math
import os
import sqlite3
import threading
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(os.environ.get("STATIC_DIR", str(ROOT / "worker" / "public"))).resolve()
DB_PATH = Path(os.environ.get("HISTORY_DB_PATH", str(ROOT / "local" / "data" / "history.sqlite3"))).resolve()
INGEST_TOKEN = os.environ.get("LOCAL_INGEST_TOKEN", "")
WORKER_STATUS_URL = os.environ.get("WORKER_STATUS_URL", "").rstrip("/")
INTERVAL_SECONDS = max(1, int(os.environ.get("PROBE_INTERVAL_SECONDS", "60")))
MISSING_BEAT_THRESHOLD = max(1, int(os.environ.get("LOCAL_MISSING_BEAT_THRESHOLD", "1")))
HEALTH_FAILURE_THRESHOLD = max(1, int(os.environ.get("LOCAL_HEALTH_FAILURE_THRESHOLD", "3")))
GAP_GRACE_SECONDS = max(5, INTERVAL_SECONDS // 10)


def complete_speedtest(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    return all(
        isinstance(value.get(name), (int, float))
        and math.isfinite(float(value[name]))
        and float(value[name]) >= 0
        for name in ("download_mbps", "upload_mbps")
    )


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.connection.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS beats (
              id INTEGER PRIMARY KEY,
              isp_id TEXT NOT NULL,
              boot_id TEXT NOT NULL,
              seq INTEGER NOT NULL,
              probe_ts TEXT NOT NULL,
              received_at TEXT NOT NULL,
              flags INTEGER NOT NULL,
              latency_ms INTEGER,
              UNIQUE (isp_id, boot_id, seq)
            );
            CREATE INDEX IF NOT EXISTS idx_beats_isp_time ON beats (isp_id, probe_ts);
            CREATE TABLE IF NOT EXISTS metadata_events (
              id INTEGER PRIMARY KEY,
              isp_id TEXT NOT NULL,
              recorded_at TEXT NOT NULL,
              metadata_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS speedtest_results (
              id INTEGER PRIMARY KEY,
              isp_id TEXT NOT NULL,
              result_id INTEGER NOT NULL,
              recorded_at TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              UNIQUE (isp_id, result_id)
            );
            CREATE TABLE IF NOT EXISTS heartbeat_gaps (
              id INTEGER PRIMARY KEY,
              isp_id TEXT NOT NULL,
              started_at TEXT NOT NULL,
              ended_at TEXT NOT NULL,
              duration_seconds INTEGER NOT NULL,
              reason TEXT NOT NULL,
              UNIQUE (isp_id, started_at)
            );
            CREATE TABLE IF NOT EXISTS outages (
              id INTEGER PRIMARY KEY,
              isp_id TEXT NOT NULL,
              started_at TEXT NOT NULL,
              ended_at TEXT,
              duration_seconds INTEGER,
              reason TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS isp_state (
              isp_id TEXT PRIMARY KEY,
              health_up INTEGER NOT NULL,
              failures INTEGER NOT NULL,
              open_outage_id INTEGER,
              latest_received_at TEXT
            );
            """
        )
        self.connection.commit()

    def ingest(self, payload: dict) -> dict:
        isp = payload.get("isp_id")
        if isp not in {"isp1", "isp2"} or payload.get("v") != 2:
            raise ValueError("invalid heartbeat")
        boot_id = payload.get("boot_id")
        seq = payload.get("seq")
        probe_ts = payload.get("ts")
        flags = payload.get("f")
        latency = payload.get("l")
        if not isinstance(boot_id, str) or not isinstance(seq, int) or seq < 1 or not isinstance(probe_ts, str) or not isinstance(flags, int):
            raise ValueError("invalid heartbeat fields")

        received_at = iso_now()
        with self.lock, self.connection:
            existing = self.connection.execute(
                "SELECT id FROM beats WHERE isp_id = ? AND boot_id = ? AND seq = ?",
                (isp, boot_id, seq),
            ).fetchone()
            if existing:
                return {"ok": True, "accepted": False, "duplicate": True}

            previous = self.connection.execute(
                "SELECT probe_ts FROM beats WHERE isp_id = ? ORDER BY received_at DESC LIMIT 1", (isp,)
            ).fetchone()
            if previous:
                previous_time = parse_iso(previous["probe_ts"])
                current_time = parse_iso(probe_ts)
                elapsed_seconds = (current_time - previous_time).total_seconds() if previous_time and current_time else 0
                gap_threshold = INTERVAL_SECONDS * MISSING_BEAT_THRESHOLD + GAP_GRACE_SECONDS
                if previous_time and current_time and elapsed_seconds > gap_threshold:
                    started = (previous_time + timedelta(seconds=INTERVAL_SECONDS)).isoformat().replace("+00:00", "Z")
                    self.connection.execute(
                        "INSERT OR IGNORE INTO heartbeat_gaps (isp_id, started_at, ended_at, duration_seconds, reason) VALUES (?, ?, ?, ?, ?)",
                        (isp, started, probe_ts, max(0, int(elapsed_seconds - INTERVAL_SECONDS)), "heartbeat_missing"),
                    )

            self.connection.execute(
                "INSERT INTO beats (isp_id, boot_id, seq, probe_ts, received_at, flags, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (isp, boot_id, seq, probe_ts, received_at, flags, latency),
            )
            metadata = payload.get("m")
            if metadata is not None:
                self.connection.execute(
                    "INSERT INTO metadata_events (isp_id, recorded_at, metadata_json) VALUES (?, ?, ?)",
                    (isp, probe_ts, json.dumps(metadata, separators=(",", ":"))),
                )
            speedtest = payload.get("s")
            if complete_speedtest(speedtest) and isinstance(speedtest.get("result_id"), int):
                self.connection.execute(
                    "INSERT OR IGNORE INTO speedtest_results (isp_id, result_id, recorded_at, payload_json) VALUES (?, ?, ?, ?)",
                    (isp, speedtest["result_id"], speedtest.get("recorded_at", probe_ts), json.dumps(speedtest, separators=(",", ":"))),
                )
            self._update_health(isp, probe_ts, flags)
        return {"ok": True, "accepted": True, "duplicate": False}

    def _update_health(self, isp: str, when: str, flags: int) -> None:
        row = self.connection.execute("SELECT * FROM isp_state WHERE isp_id = ?", (isp,)).fetchone()
        healthy = (flags & 7) == 7
        if row is None:
            self.connection.execute("INSERT INTO isp_state VALUES (?, ?, ?, ?, ?)", (isp, 1 if healthy else 0, 0 if healthy else 1, None, when))
            if not healthy and HEALTH_FAILURE_THRESHOLD <= 1:
                self._open_outage(isp, when, "checks_failed")
            return
        failures = 0 if healthy else row["failures"] + 1
        if healthy and row["health_up"] == 0 and row["open_outage_id"]:
            outage = self.connection.execute("SELECT * FROM outages WHERE id = ?", (row["open_outage_id"],)).fetchone()
            if outage:
                start = parse_iso(outage["started_at"])
                end = parse_iso(when)
                duration = max(0, int((end - start).total_seconds())) if start and end else 0
                self.connection.execute("UPDATE outages SET ended_at = ?, duration_seconds = ? WHERE id = ?", (when, duration, outage["id"]))
            self.connection.execute("UPDATE isp_state SET health_up = 1, failures = 0, open_outage_id = NULL, latest_received_at = ? WHERE isp_id = ?", (when, isp))
            return
        if not healthy and row["health_up"] == 1 and failures >= HEALTH_FAILURE_THRESHOLD:
            outage_id = self._open_outage(isp, when, "checks_failed")
            self.connection.execute("UPDATE isp_state SET health_up = 0, failures = ?, open_outage_id = ?, latest_received_at = ? WHERE isp_id = ?", (failures, outage_id, when, isp))
            return
        self.connection.execute("UPDATE isp_state SET failures = ?, latest_received_at = ? WHERE isp_id = ?", (failures, when, isp))

    def _open_outage(self, isp: str, when: str, reason: str) -> int:
        cursor = self.connection.execute("INSERT INTO outages (isp_id, started_at, reason) VALUES (?, ?, ?)", (isp, when, reason))
        return int(cursor.lastrowid)

    def outage_history(self, isp: str, days: int) -> dict:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        since_iso = since.isoformat().replace("+00:00", "Z")
        now = iso_now()
        with self.lock:
            rows = self.connection.execute("SELECT * FROM outages WHERE isp_id = ? AND started_at <= ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY started_at DESC", (isp, now, since_iso)).fetchall()
            oldest = self.connection.execute("SELECT MIN(started_at) AS oldest FROM outages WHERE isp_id = ?", (isp,)).fetchone()["oldest"]
        outages = []
        down = 0
        window = max(1, int((datetime.now(timezone.utc) - since).total_seconds()))
        for row in rows:
            start_time = parse_iso(row["started_at"])
            end_time = parse_iso(row["ended_at"]) if row["ended_at"] else datetime.now(timezone.utc)
            duration = max(0, int((end_time - start_time).total_seconds())) if start_time and end_time else 0
            if row["ended_at"] is not None and duration < INTERVAL_SECONDS:
                continue
            start = max(start_time or since, since)
            end = min(end_time, datetime.now(timezone.utc))
            duration = max(0, int((end - start).total_seconds()))
            down += duration
            outages.append({"id": row["id"], "started_at": row["started_at"], "ended_at": row["ended_at"], "duration_seconds": row["duration_seconds"], "reason": row["reason"], "ongoing": row["ended_at"] is None})
        parsed_oldest = parse_iso(oldest)
        available_days = 0 if not parsed_oldest else max(1, int(((datetime.now(timezone.utc) - parsed_oldest).total_seconds() + 86399) // 86400))
        return {"isp_id": isp, "label": isp.upper(), "days": days, "available_days": available_days, "uptime_percent": round(max(0, window - down) / window * 100, 2), "outages": outages, "history_available": True}

    def latency_history(self, isp: str, days: int | None, hours: int | None) -> dict:
        period_seconds = (hours * 3600) if hours else (days or 7) * 86400
        since = datetime.now(timezone.utc) - timedelta(seconds=period_seconds)
        since_iso = since.isoformat().replace("+00:00", "Z")
        with self.lock:
            rows = self.connection.execute("SELECT probe_ts, latency_ms FROM beats WHERE isp_id = ? AND probe_ts >= ? AND latency_ms IS NOT NULL ORDER BY probe_ts ASC", (isp, since_iso)).fetchall()
            gaps = self.connection.execute("SELECT * FROM heartbeat_gaps WHERE isp_id = ? AND started_at <= ? AND ended_at >= ? AND duration_seconds > ? ORDER BY started_at DESC", (isp, iso_now(), since_iso, INTERVAL_SECONDS * (MISSING_BEAT_THRESHOLD - 1) + GAP_GRACE_SECONDS)).fetchall()
            oldest = self.connection.execute("SELECT MIN(probe_ts) AS oldest FROM beats WHERE isp_id = ? AND latency_ms IS NOT NULL", (isp,)).fetchone()["oldest"]
        gap_rows = [{"started_at": row["started_at"], "ended_at": row["ended_at"], "duration_seconds": row["duration_seconds"], "reason": row["reason"]} for row in gaps]
        available_hours = self.available_hours(oldest)
        if period_seconds > 24 * 3600:
            buckets: dict[str, list[int]] = {}
            for row in rows:
                parsed = parse_iso(row["probe_ts"])
                if not parsed:
                    continue
                bucket = parsed.replace(minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")
                buckets.setdefault(bucket, []).append(row["latency_ms"])
            points = [{"recorded_at": key, "min_latency_ms": min(values), "max_latency_ms": max(values), "sample_count": len(values)} for key, values in sorted(buckets.items())]
            return {"isp_id": isp, "label": isp.upper(), "days": days, "hours": hours, "available_hours": available_hours, "granularity": "hour", "points": points, "gaps": gap_rows, "history_available": True}
        return {"isp_id": isp, "label": isp.upper(), "days": days, "hours": hours, "available_hours": available_hours, "granularity": "sample", "points": [{"recorded_at": row["probe_ts"], "latency_ms": row["latency_ms"]} for row in rows], "gaps": gap_rows, "history_available": True}

    @staticmethod
    def available_hours(oldest: str | None) -> int:
        parsed = parse_iso(oldest)
        if not parsed:
            return 0
        age = max(0, (datetime.now(timezone.utc) - parsed).total_seconds())
        return max(1, int((age + 3599) // 3600))

    def speedtests(self, isp: str, days: int) -> dict:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat().replace("+00:00", "Z")
        with self.lock:
            rows = self.connection.execute("SELECT payload_json FROM speedtest_results WHERE isp_id = ? AND datetime(recorded_at) >= datetime(?) ORDER BY datetime(recorded_at) ASC", (isp, since)).fetchall()
            oldest = self.connection.execute("SELECT MIN(recorded_at) AS oldest FROM speedtest_results WHERE isp_id = ?", (isp,)).fetchone()["oldest"]
        parsed = parse_iso(oldest.replace(" ", "T") + "Z") if oldest and "T" not in oldest else parse_iso(oldest)
        age_days = 0 if not parsed else max(1, int(((datetime.now(timezone.utc) - parsed).total_seconds() + 86399) // 86400))
        results = [json.loads(row["payload_json"]) for row in rows]
        return {"isp_id": isp, "label": isp.upper(), "days": days, "available_days": age_days, "results": [result for result in results if complete_speedtest(result)], "history_available": True}

    def status(self) -> dict:
        isps = []
        since = datetime.now(timezone.utc) - timedelta(days=1)
        since_iso = since.isoformat().replace("+00:00", "Z")
        now = datetime.now(timezone.utc)
        for isp in ("isp1", "isp2"):
            with self.lock:
                beat = self.connection.execute("SELECT * FROM beats WHERE isp_id = ? ORDER BY received_at DESC LIMIT 1", (isp,)).fetchone()
                metadata_row = self.connection.execute("SELECT metadata_json FROM metadata_events WHERE isp_id = ? ORDER BY recorded_at DESC LIMIT 1", (isp,)).fetchone()
                speedtest_row = self.connection.execute("SELECT payload_json FROM speedtest_results WHERE isp_id = ? ORDER BY recorded_at DESC LIMIT 1", (isp,)).fetchone()
                gaps = self.connection.execute("SELECT started_at, ended_at, duration_seconds FROM heartbeat_gaps WHERE isp_id = ? AND started_at <= ? AND ended_at >= ? AND duration_seconds > ?", (isp, iso_now(), since_iso, INTERVAL_SECONDS * (MISSING_BEAT_THRESHOLD - 1) + GAP_GRACE_SECONDS)).fetchall()
            if beat is None:
                continue
            metadata = json.loads(metadata_row["metadata_json"]) if metadata_row else {}
            last_received = parse_iso(beat["received_at"])
            age = None if last_received is None else max(0, int((datetime.now(timezone.utc) - last_received).total_seconds()))
            is_up = age is not None and age < INTERVAL_SECONDS * MISSING_BEAT_THRESHOLD + GAP_GRACE_SECONDS
            flags = beat["flags"]
            speedtest = json.loads(speedtest_row["payload_json"]) if speedtest_row else None
            if not complete_speedtest(speedtest):
                speedtest = None
            probe_silent_seconds = 0
            for gap in gaps:
                start = max(parse_iso(gap["started_at"]) or since, since)
                end = min(parse_iso(gap["ended_at"]) or now, now)
                probe_silent_seconds += max(0, int((end - start).total_seconds()))
            isps.append({
                "isp_id": isp,
                "label": isp.upper(),
                "is_up": is_up,
                "display_state": "up" if is_up else "down",
                "health_state": "healthy" if (flags & 7) == 7 else "degraded",
                "last_seen_at": beat["received_at"],
                "last_beat_probe_at": beat["probe_ts"],
                "heartbeat_age_seconds": age,
                "heartbeat_stale": age is None or age >= INTERVAL_SECONDS,
                "missed_beats": 0 if age is None else age // INTERVAL_SECONDS,
                "probe_silent_seconds_24h": probe_silent_seconds,
                "checks": {
                    "internet_ok": bool(flags & 1),
                    "dns_ok": bool(flags & 2),
                    "https_ok": bool(flags & 4),
                    "https_latency_ms": beat["latency_ms"],
                },
                "public_ipv4": metadata.get("public_ipv4"),
                "isp_name": metadata.get("isp_name"),
                "network_asn": metadata.get("network_asn"),
                "traceroute": metadata.get("traceroute"),
                "latest_speedtest": speedtest,
            })
        return {"generated_at": iso_now(), "isps": isps, "status_page_url": "", "history_available": True}

    def sync_export(self, request: dict) -> dict:
        isp = request.get("isp_id")
        if isp not in {"isp1", "isp2"} or request.get("v") != 2:
            raise ValueError("invalid sync request")
        limit = min(500, max(1, int(request.get("limit", 500))))
        heartbeat_since = str(request.get("heartbeat_since", "1970-01-01T00:00:00Z"))
        speedtest_since = str(request.get("speedtest_since", "1970-01-01T00:00:00Z"))
        outage_since = str(request.get("outage_since", "1970-01-01T00:00:00Z"))
        cursors = request.get("cursors") if isinstance(request.get("cursors"), dict) else {}
        heartbeat_cursor = None if cursors.get("heartbeat", 0) is None else max(0, int(cursors.get("heartbeat", 0)))
        speedtest_cursor = None if cursors.get("speedtest", 0) is None else max(0, int(cursors.get("speedtest", 0)))
        outage_cursor = None if cursors.get("outage", 0) is None else max(0, int(cursors.get("outage", 0)))
        with self.lock:
            heartbeat_rows = [] if heartbeat_cursor is None else self.connection.execute(
                "SELECT id, boot_id, seq, probe_ts, flags, latency_ms FROM beats WHERE isp_id = ? AND id > ? AND probe_ts >= ? ORDER BY id ASC LIMIT ?",
                (isp, heartbeat_cursor, heartbeat_since, limit),
            ).fetchall()
            speedtest_rows = [] if speedtest_cursor is None else self.connection.execute(
                "SELECT id, payload_json FROM speedtest_results WHERE isp_id = ? AND id > ? AND datetime(recorded_at) >= datetime(?) ORDER BY id ASC LIMIT ?",
                (isp, speedtest_cursor, speedtest_since, limit),
            ).fetchall()
            outage_rows = [] if outage_cursor is None else self.connection.execute(
                "SELECT id, started_at, ended_at, duration_seconds, reason FROM outages WHERE isp_id = ? AND id > ? AND started_at >= ? ORDER BY id ASC LIMIT ?",
                (isp, outage_cursor, outage_since, limit),
            ).fetchall()
            oldest_heartbeat = self.connection.execute("SELECT MIN(probe_ts) AS oldest FROM beats WHERE isp_id = ?", (isp,)).fetchone()["oldest"]
            oldest_speedtest = self.connection.execute("SELECT MIN(recorded_at) AS oldest FROM speedtest_results WHERE isp_id = ?", (isp,)).fetchone()["oldest"]
            oldest_outage = self.connection.execute("SELECT MIN(started_at) AS oldest FROM outages WHERE isp_id = ?", (isp,)).fetchone()["oldest"]
        next_cursors = {
            "heartbeat": int(heartbeat_rows[-1]["id"]) if len(heartbeat_rows) == limit else None,
            "speedtest": int(speedtest_rows[-1]["id"]) if len(speedtest_rows) == limit else None,
            "outage": int(outage_rows[-1]["id"]) if len(outage_rows) == limit else None,
        }
        return {
            "ok": True,
            "isp_id": isp,
            "heartbeats": [{"boot_id": row["boot_id"], "seq": row["seq"], "probe_ts": row["probe_ts"], "flags": row["flags"], "latency_ms": row["latency_ms"]} for row in heartbeat_rows],
            "speedtests": [json.loads(row["payload_json"]) for row in speedtest_rows if complete_speedtest(json.loads(row["payload_json"]))],
            "outages": [{"started_at": row["started_at"], "ended_at": row["ended_at"], "duration_seconds": row["duration_seconds"], "reason": row["reason"]} for row in outage_rows],
            "next_cursors": next_cursors,
            "complete": all(value is None for value in next_cursors.values()),
            "source_oldest": {"heartbeat": oldest_heartbeat, "speedtest": oldest_speedtest, "outage": oldest_outage},
        }


STORE = Store(DB_PATH)


class Handler(BaseHTTPRequestHandler):
    server_version = "local-history/1"

    def log_message(self, fmt: str, *args: object) -> None:
        print(fmt % args, flush=True)

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_POST(self) -> None:
        if self.path not in {"/api/ingest", "/api/sync/export"}:
            self.send_json({"error": "Not Found"}, 404)
            return
        if not INGEST_TOKEN or self.headers.get("Authorization") != f"Bearer {INGEST_TOKEN}":
            self.send_json({"error": "Unauthorized"}, 401)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 65536:
            self.send_json({"error": "Invalid body"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length))
            self.send_json(STORE.sync_export(payload) if self.path == "/api/sync/export" else STORE.ingest(payload))
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, 400)
        except Exception:
            self.send_json({"error": "Storage failure"}, 500)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            isp = query.get("isp", [""])[0]
            if parsed.path == "/health":
                self.send_json({"ok": True, "database": str(DB_PATH)})
                return
            if parsed.path == "/api/status":
                if WORKER_STATUS_URL:
                    request = urllib.request.Request(
                        f"{WORKER_STATUS_URL}/api/status",
                        headers={"Accept": "application/json", "User-Agent": "monitoring-local/1"},
                    )
                    try:
                        with urllib.request.urlopen(request, timeout=10) as result:
                            self.send_json(json.loads(result.read()))
                            return
                    except (urllib.error.URLError, ValueError):
                        pass
                self.send_json(STORE.status())
                return
            if parsed.path == "/api/history/outages":
                if isp not in {"isp1", "isp2"}:
                    self.send_json({"error": "Invalid isp"}, 400)
                    return
                self.send_json(STORE.outage_history(isp, min(365, max(1, int(query.get("days", ["7"])[0])))))
                return
            if parsed.path == "/api/history/latency":
                if isp not in {"isp1", "isp2"}:
                    self.send_json({"error": "Invalid isp"}, 400)
                    return
                hours = int(query["hours"][0]) if "hours" in query else None
                days = int(query["days"][0]) if "days" in query else None
                self.send_json(STORE.latency_history(isp, min(365, max(1, days)) if days else None, min(24 * 365, max(1, hours)) if hours else None))
                return
            if parsed.path == "/api/history/speedtests":
                if isp not in {"isp1", "isp2"}:
                    self.send_json({"error": "Invalid isp"}, 400)
                    return
                self.send_json(STORE.speedtests(isp, min(365, max(1, int(query.get("days", ["7"])[0])))))
                return
            path = unquote(parsed.path).lstrip("/") or "index.html"
            local_favicon = path == "favicon-local.svg"
            candidate = (STATIC_DIR / ("favicon.svg" if local_favicon else path)).resolve()
            if STATIC_DIR not in candidate.parents and candidate != STATIC_DIR:
                self.send_json({"error": "Not Found"}, 404)
                return
            if not candidate.is_file():
                self.send_json({"error": "Not Found"}, 404)
                return
            content = candidate.read_bytes()
            if local_favicon:
                content = content.replace(b'fill="#101820"', b'fill="#4338ca"')
            content_type = "application/octet-stream"
            if candidate.suffix == ".html":
                content_type = "text/html; charset=utf-8"
                if candidate.name == "index.html":
                    content = content.replace(
                        b"<title>Network Monitoring</title>",
                        b"<title>[Lan] Network Monitoring</title>",
                    )
                    content = content.replace(
                        b'href="/favicon.svg"',
                        b'href="/favicon-local.svg"',
                    )
            elif candidate.name == "favicon.svg":
                content_type = "image/svg+xml"
            elif candidate.suffix == ".js":
                content_type = "text/javascript; charset=utf-8"
            elif candidate.suffix == ".css":
                content_type = "text/css; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            if candidate.name == "index.html" or candidate.name == "favicon.svg":
                self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except (ValueError, KeyError):
            self.send_json({"error": "Invalid query"}, 400)


def main() -> None:
    host = os.environ.get("LOCAL_BIND_HOST", "0.0.0.0")
    port = int(os.environ.get("LOCAL_PORT", "8788"))
    print(f"local history listening on {host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
