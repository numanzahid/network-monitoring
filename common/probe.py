#!/usr/bin/env python3
"""Shared ISP probe for compact remote liveness and local history ingestion."""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import math
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise SystemExit(f"Missing configuration: {name}")
    return value


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return default if raw is None or raw == "" else int(raw)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_url(url: str, path: str) -> str:
    cleaned = url.strip().rstrip("/")
    return cleaned if cleaned.endswith(path) else f"{cleaned}{path}"


def check_dns(hostname: str, timeout: float) -> bool:
    previous = socket.getdefaulttimeout()
    socket.setdefaulttimeout(timeout)
    try:
        socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
        return True
    except OSError:
        return False
    finally:
        socket.setdefaulttimeout(previous)


def check_https(url: str, timeout: float) -> tuple[bool, int | None]:
    started = time.perf_counter()
    try:
        result = requests.get(url, timeout=timeout)
        return result.ok, int((time.perf_counter() - started) * 1000)
    except requests.RequestException:
        return False, None


def check_public_ip(url: str, timeout: float) -> str | None:
    try:
        result = requests.get(url, timeout=timeout)
        if not result.ok:
            return None
        address = ipaddress.ip_address(result.text.strip())
        return str(address) if address.version == 4 else None
    except (requests.RequestException, ValueError):
        return None


def lookup_network_identity(public_ipv4: str | None, timeout: float) -> dict[str, str | None]:
    if not public_ipv4:
        return {"isp_name": None, "network_asn": None}
    try:
        result = requests.get(f"https://ipapi.co/{public_ipv4}/json/", timeout=timeout, headers={"User-Agent": "monitoring-probe/2"})
        payload = result.json()
        if result.ok:
            return {"isp_name": payload.get("org") or payload.get("asn"), "network_asn": payload.get("asn")}
    except (requests.RequestException, ValueError):
        pass
    return {"isp_name": None, "network_asn": None}


def run_traceroute(target: str, max_hops: int, timeout: float) -> list[str] | None:
    if not shutil.which("traceroute"):
        return None
    try:
        result = subprocess.run(["traceroute", "-n", "-w", "2", "-q", "1", "-m", str(max_hops), target], capture_output=True, text=True, timeout=timeout, check=False)
    except (subprocess.SubprocessError, OSError):
        return None
    if result.returncode != 0 and not result.stdout:
        return None
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return lines or None


def get_traceroute(target: str, max_hops: int, interval: int, timeout: float) -> list[str] | None:
    cache = Path(os.environ.get("STATE_DIR", "/state")) / "traceroute.json"
    try:
        cached = json.loads(cache.read_text()) if cache.exists() else None
        if cached and time.time() - float(cached.get("at", 0)) < interval:
            return cached.get("lines")
    except (OSError, ValueError, TypeError):
        pass
    lines = run_traceroute(target, max_hops, timeout)
    if lines:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"at": time.time(), "lines": lines}))
    return lines


def bits_to_mbps(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number > 10000:
        number /= 1_000_000
    return round(number, 2)


def complete_speedtest(value: dict[str, Any]) -> bool:
    return all(
        isinstance(value.get(name), (int, float))
        and math.isfinite(float(value[name]))
        and float(value[name]) >= 0
        for name in ("download_mbps", "upload_mbps")
    )


def fetch_latest_speedtest(tracker_ip: str, api_token: str, timeout: float) -> dict[str, Any] | None:
    try:
        result = requests.get(f"http://{tracker_ip}/api/v1/results", headers={"Authorization": f"Bearer {api_token}", "Accept": "application/json"}, params={"per_page": 1, "sort": "-created_at"}, timeout=timeout)
        if not result.ok:
            return None
        rows = result.json().get("data")
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            return None
        row = rows[0]
        result_id = row.get("id")
        if result_id is None:
            return None
        server = row.get("server")
        speedtest = {"result_id": int(result_id), "recorded_at": str(row.get("created_at") or row.get("updated_at") or utc_now()), "download_mbps": bits_to_mbps(row.get("download")), "upload_mbps": bits_to_mbps(row.get("upload")), "ping_ms": row.get("ping"), "jitter_ms": row.get("jitter"), "packet_loss": row.get("packet_loss"), "server_name": server.get("name") if isinstance(server, dict) else None}
        return speedtest if complete_speedtest(speedtest) else None
    except (requests.RequestException, ValueError, TypeError):
        return None


class ProbeState:
    def __init__(self, directory: Path) -> None:
        self.path = directory / "state.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.data = json.loads(self.path.read_text())
        except (OSError, ValueError):
            self.data = {"boot_id": uuid.uuid4().hex, "seq": 0, "metadata_hash": "", "metadata_sent_at": 0, "speedtest_id": None}

    def next_seq(self) -> int:
        self.data["seq"] = int(self.data.get("seq", 0)) + 1
        self.save()
        return self.data["seq"]

    def save(self) -> None:
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.data, separators=(",", ":")))
        temporary.replace(self.path)


def sign(secret: str, message: str) -> str:
    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def post_json(url: str, token: str | None, body: str, timeout: float) -> requests.Response:
    headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "monitoring-probe/2"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    result = requests.post(url, data=body, headers=headers, timeout=timeout)
    if result.status_code >= 400:
        raise RuntimeError(f"request failed ({result.status_code})")
    return result


def post_signed_json(url: str, secret: str, body: str, timestamp: str, boot_id: str, sequence: int, timeout: float) -> requests.Response:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "monitoring-probe/2",
        "Authorization": f"Bearer {sign(secret, f'{timestamp}.{boot_id}.{sequence}.{body}')}",
        "X-Probe-Timestamp": timestamp,
        "X-Probe-Boot-Id": boot_id,
        "X-Probe-Sequence": str(sequence),
    }
    result = requests.post(url, data=body, headers=headers, timeout=timeout)
    if result.status_code >= 400:
        raise RuntimeError(f"request failed ({result.status_code})")
    return result


def queue_local(queue_dir: Path, body: str, seq: int) -> None:
    queue_dir.mkdir(parents=True, exist_ok=True)
    temporary = queue_dir / f"{seq:020d}.tmp"
    temporary.write_text(body)
    temporary.replace(queue_dir / f"{seq:020d}.json")


def flush_local(url: str, token: str, queue_dir: Path, timeout: float) -> None:
    if not url:
        return
    queue_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(queue_dir.glob("*.json")):
        try:
            post_json(url, token, path.read_text(), timeout)
            path.unlink()
        except (OSError, requests.RequestException, RuntimeError):
            break


def sync_history(local_base: str, local_token: str, worker_base: str, secret: str, state: ProbeState, sync_request: dict[str, Any], isp_id: str, boot_id: str, sequence: int, timeout: float) -> None:
    request_id = sync_request.get("request_id")
    if not isinstance(request_id, str) or not request_id:
        return
    saved = state.data.get("history_sync") if isinstance(state.data.get("history_sync"), dict) else {}
    if saved.get("request_id") != request_id:
        cursors = {"heartbeat": 0, "speedtest": 0, "outage": 0}
    else:
        cursors = saved.get("cursors") if isinstance(saved.get("cursors"), dict) else {"heartbeat": 0, "speedtest": 0, "outage": 0}
    export_request = {
        "v": 2,
        "isp_id": isp_id,
        "heartbeat_since": sync_request.get("heartbeat_since"),
        "speedtest_since": sync_request.get("speedtest_since"),
        "outage_since": sync_request.get("outage_since"),
        "cursors": cursors,
        "limit": 500,
    }
    export_response = post_json(normalize_url(local_base, "/api/sync/export"), local_token, json.dumps(export_request, separators=(",", ":"), sort_keys=True), timeout)
    export = export_response.json()
    if not isinstance(export, dict) or export.get("ok") is not True:
        raise RuntimeError("invalid local history export")
    batch = {
        "v": 2,
        "isp_id": isp_id,
        "sync_id": request_id,
        "complete": export.get("complete") is True,
        "heartbeats": export.get("heartbeats", []),
        "speedtests": export.get("speedtests", []),
        "outages": export.get("outages", []),
        "source_oldest": export.get("source_oldest", {}),
    }
    batch_body = json.dumps(batch, separators=(",", ":"), sort_keys=True)
    sync_response = post_signed_json(normalize_url(worker_base, "/api/history/sync"), secret, batch_body, utc_now(), boot_id, sequence, timeout)
    acknowledgement = sync_response.json()
    if not isinstance(acknowledgement, dict) or acknowledgement.get("ok") is not True:
        raise RuntimeError("invalid remote history acknowledgement")
    state.data["history_sync"] = {"request_id": request_id, "cursors": export.get("next_cursors", {})}
    if isinstance(acknowledgement.get("history_sync"), dict) and acknowledgement["history_sync"].get("required") is False:
        state.data["history_sync"]["complete"] = True
    state.save()


def build_measurements(timeout: float) -> tuple[int, int | None, dict[str, Any], dict[str, Any] | None]:
    dns_ok = check_dns(env("DNS_HOST", "1.1.1.1"), timeout)
    https_ok, latency = check_https(env("HTTPS_CHECK_URL", "https://1.1.1.1/cdn-cgi/trace"), timeout)
    public_ipv4 = check_public_ip(env("PUBLIC_IP_URL", "https://ipv4.icanhazip.com"), timeout)
    try:
        internet_ok = requests.get(env("INTERNET_CHECK_URL", "https://cloudflare.com/cdn-cgi/trace"), timeout=timeout).ok
    except requests.RequestException:
        internet_ok = False
    identity = lookup_network_identity(public_ipv4, timeout)
    traceroute = get_traceroute(env("TRACEROUTE_TARGET", "1.1.1.1"), env_int("TRACEROUTE_MAX_HOPS", 8), env_int("TRACEROUTE_INTERVAL_SECONDS", 900), float(os.environ.get("TRACEROUTE_TIMEOUT_SECONDS", "45")))
    speedtest = fetch_latest_speedtest(env("TRACKER_IP"), os.environ.get("SPEEDTEST_API_TOKEN", ""), timeout)
    flags = (1 if internet_ok else 0) | (2 if dns_ok else 0) | (4 if https_ok else 0)
    return flags, latency, {"public_ipv4": public_ipv4, "isp_name": identity["isp_name"], "network_asn": identity["network_asn"], "traceroute": traceroute}, speedtest


def run_once(state: ProbeState) -> None:
    isp_id = env("ISP_ID")
    secret = env("PROBE_SECRET")
    timeout = float(env("REQUEST_TIMEOUT_SECONDS", "10"))
    worker_url = normalize_url(env("WORKER_URL"), "/api/heartbeat")
    worker_base = worker_url.removesuffix("/api/heartbeat")
    local_base = os.environ.get("LOCAL_URL", "").strip()
    local_url = normalize_url(local_base, "/api/ingest") if local_base else ""
    local_token = os.environ.get("LOCAL_INGEST_TOKEN", "")
    state_dir = Path(os.environ.get("STATE_DIR", "/state"))
    queue_dir = Path(os.environ.get("LOCAL_SPOOL_DIR", str(state_dir / "local-queue")))
    flags, latency, metadata, speedtest = build_measurements(timeout)
    timestamp = utc_now()
    seq = state.next_seq()
    metadata_json = json.dumps(metadata, sort_keys=True, separators=(",", ":"))
    metadata_hash = hashlib.sha256(metadata_json.encode()).hexdigest()
    metadata_changed = metadata_hash != state.data.get("metadata_hash") or time.time() - float(state.data.get("metadata_sent_at", 0)) >= env_int("METADATA_KEEPALIVE_SECONDS", 21600)
    speedtest_changed = speedtest is not None and speedtest.get("result_id") != state.data.get("speedtest_id")
    payload: dict[str, Any] = {"v": 2, "isp_id": isp_id, "boot_id": state.data["boot_id"], "seq": seq, "ts": timestamp, "f": flags, "l": latency}
    if metadata_changed:
        payload["m"] = metadata
        state.data["metadata_hash"] = metadata_hash
        state.data["metadata_sent_at"] = time.time()
    if speedtest_changed:
        payload["s"] = speedtest
        state.data["speedtest_id"] = speedtest["result_id"]
    state.save()
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    if local_url:
        try:
            flush_local(local_url, local_token, queue_dir, timeout)
            post_json(local_url, local_token, body, timeout)
        except (OSError, requests.RequestException, RuntimeError) as error:
            queue_local(queue_dir, body, seq)
            print(f"[{timestamp}] local history queued: {error}", file=sys.stderr, flush=True)
    signature = sign(secret, f"{timestamp}.{state.data['boot_id']}.{seq}.{body}")
    remote_response = post_json(worker_url, signature, body, timeout)
    try:
        remote_ack = remote_response.json()
        sync_request = remote_ack.get("history_sync") if isinstance(remote_ack, dict) else None
        if local_url and isinstance(sync_request, dict) and sync_request.get("required") is True:
            sync_history(local_base, local_token, worker_base, secret, state, sync_request, isp_id, state.data["boot_id"], seq, timeout)
    except (ValueError, OSError, requests.RequestException, RuntimeError) as error:
        print(f"[{timestamp}] history sync deferred: {error}", file=sys.stderr, flush=True)


def main() -> None:
    missing = [name for name in ("ISP_ID", "TRACKER_IP", "WORKER_URL", "PROBE_SECRET") if not os.environ.get(name)]
    if missing:
        raise SystemExit("Missing configuration: " + ", ".join(missing))
    state = ProbeState(Path(os.environ.get("STATE_DIR", "/state")))
    interval = env_int("CHECK_INTERVAL_SECONDS", 60)
    print(f"Starting probe for {os.environ['ISP_ID']} (interval={interval}s)", flush=True)
    while True:
        started = time.monotonic()
        try:
            run_once(state)
            print(f"[{utc_now()}] heartbeat sent", flush=True)
        except Exception as error:  # noqa: BLE001
            print(f"[{utc_now()}] heartbeat error: {error}", file=sys.stderr, flush=True)
        time.sleep(max(1, interval - int(time.monotonic() - started)))


if __name__ == "__main__":
    main()
