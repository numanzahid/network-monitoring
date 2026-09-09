#!/usr/bin/env python3
"""ISP probe that reports health checks and speedtests to the Worker API."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import requests

_CACHED_ISP_FOR_IP: dict[str, dict[str, str | None]] = {}
_LAST_TRACEROUTE_AT = 0.0
_LAST_TRACEROUTE_LINES: list[str] | None = None


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise SystemExit(f"Missing configuration: {name}")
    return value


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return int(raw)


def normalize_worker_url(url: str) -> str:
    cleaned = url.strip().rstrip("/")
    if cleaned.endswith("/api/heartbeat"):
        return cleaned
    return f"{cleaned}/api/heartbeat"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def check_dns(hostname: str, timeout: float) -> bool:
    try:
        socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
        return True
    except OSError:
        return False


def check_https(url: str, timeout: float) -> tuple[bool, int | None]:
    started = time.perf_counter()
    try:
        response = requests.get(url, timeout=timeout)
        latency_ms = int((time.perf_counter() - started) * 1000)
        return response.ok, latency_ms
    except requests.RequestException:
        return False, None


def check_public_ip(url: str, timeout: float) -> str | None:
    try:
        response = requests.get(url, timeout=timeout)
        if not response.ok:
            return None
        ip = response.text.strip()
        return ip if ip else None
    except requests.RequestException:
        return None


def lookup_network_identity(public_ipv4: str | None, timeout: float) -> dict[str, str | None]:
    if not public_ipv4:
        return {"isp_name": None, "network_asn": None}
    if public_ipv4 in _CACHED_ISP_FOR_IP:
        return _CACHED_ISP_FOR_IP[public_ipv4]

    result = {"isp_name": None, "network_asn": None}
    try:
        response = requests.get(
            f"http://ip-api.com/json/{public_ipv4}",
            params={"fields": "status,isp,org,as"},
            timeout=timeout,
            headers={"User-Agent": "network-monitoring-probe/1.0"},
        )
        payload = response.json()
        if response.ok and payload.get("status") == "success":
            result = {
                "isp_name": payload.get("isp") or payload.get("org"),
                "network_asn": payload.get("as"),
            }
    except (requests.RequestException, ValueError):
        pass

    _CACHED_ISP_FOR_IP[public_ipv4] = result
    return result


def run_traceroute(target: str, max_hops: int, timeout: float) -> list[str] | None:
    if not shutil.which("traceroute"):
        return None
    try:
        completed = subprocess.run(
            ["traceroute", "-n", "-w", "2", "-q", "1", "-m", str(max_hops), target],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        return None

    if completed.returncode != 0 and not completed.stdout:
        return None

    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    return lines or None


def get_traceroute_lines(
    target: str,
    max_hops: int,
    interval: int,
    timeout: float,
) -> list[str] | None:
    global _LAST_TRACEROUTE_AT, _LAST_TRACEROUTE_LINES

    if interval <= 0:
        return _LAST_TRACEROUTE_LINES

    now = time.monotonic()
    if _LAST_TRACEROUTE_LINES is not None and (now - _LAST_TRACEROUTE_AT) < interval:
        return _LAST_TRACEROUTE_LINES

    lines = run_traceroute(target, max_hops, timeout)
    if lines:
        _LAST_TRACEROUTE_AT = now
        _LAST_TRACEROUTE_LINES = lines
    return _LAST_TRACEROUTE_LINES


def check_internet(url: str, timeout: float) -> bool:
    try:
        response = requests.get(url, timeout=timeout)
        return response.ok
    except requests.RequestException:
        return False


def bits_to_mbps(value: Any) -> float | None:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric > 10000:
        return round(numeric / 1_000_000, 2)
    return round(numeric, 2)


def fetch_latest_speedtest(tracker_ip: str, api_token: str, timeout: float) -> dict[str, Any] | None:
    url = f"http://{tracker_ip}/api/v1/results"
    headers = {"Authorization": f"Bearer {api_token}", "Accept": "application/json"}
    try:
        response = requests.get(
            url,
            headers=headers,
            params={"per_page": 1, "sort": "-created_at"},
            timeout=timeout,
        )
        if not response.ok:
            return None
        payload = response.json()
    except (requests.RequestException, ValueError):
        return None

    rows = payload.get("data")
    if not isinstance(rows, list) or not rows:
        return None

    row = rows[0]
    if not isinstance(row, dict):
        return None

    server_name = None
    server = row.get("server")
    if isinstance(server, dict):
        server_name = server.get("name")

    recorded_at = row.get("created_at") or row.get("updated_at")
    if not recorded_at:
        recorded_at = utc_now()

    result_id = row.get("id")
    if result_id is None:
        return None

    return {
        "result_id": int(result_id),
        "recorded_at": str(recorded_at),
        "download_mbps": bits_to_mbps(row.get("download")),
        "upload_mbps": bits_to_mbps(row.get("upload")),
        "ping_ms": row.get("ping"),
        "jitter_ms": row.get("jitter"),
        "packet_loss": row.get("packet_loss"),
        "server_name": server_name,
    }


def build_payload(
    isp_id: str,
    dns_host: str,
    https_url: str,
    public_ip_url: str,
    internet_url: str,
    tracker_ip: str,
    api_token: str,
    timeout: float,
    traceroute_target: str,
    traceroute_max_hops: int,
    traceroute_interval: int,
    traceroute_timeout: float,
) -> dict[str, Any]:
    dns_ok = check_dns(dns_host, timeout)
    https_ok, https_latency = check_https(https_url, timeout)
    public_ipv4 = check_public_ip(public_ip_url, timeout)
    internet_ok = check_internet(internet_url, timeout)
    speedtest = fetch_latest_speedtest(tracker_ip, api_token, timeout)
    identity = lookup_network_identity(public_ipv4, timeout)
    traceroute = get_traceroute_lines(
        traceroute_target,
        traceroute_max_hops,
        traceroute_interval,
        traceroute_timeout,
    )

    return {
        "isp_id": isp_id,
        "ts": utc_now(),
        "nonce": str(uuid.uuid4()),
        "checks": {
            "internet": internet_ok,
            "dns": dns_ok,
            "https": {"ok": https_ok, "latency_ms": https_latency},
            "public_ipv4": public_ipv4,
            "isp_name": identity["isp_name"],
            "network_asn": identity["network_asn"],
            "traceroute": traceroute,
        },
        "speedtest": speedtest,
    }


def sign_payload(secret: str, ts: str, nonce: str, body: str) -> str:
    message = f"{ts}.{nonce}.{body}".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def post_heartbeat(worker_url: str, secret: str, payload: dict[str, Any], timeout: float) -> None:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    signature = sign_payload(secret, payload["ts"], payload["nonce"], body)

    try:
        response = requests.post(
            worker_url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {signature}",
                "User-Agent": "network-monitoring-probe/1.0",
            },
            timeout=timeout,
        )
    except requests.RequestException as error:
        raise RuntimeError(f"Heartbeat request failed: {error}") from error

    if response.status_code >= 400:
        detail = response.text.strip() or f"status {response.status_code}"
        raise RuntimeError(f"Heartbeat failed ({response.status_code}): {detail}")


def run_once() -> None:
    isp_id = env("ISP_ID")
    worker_url = normalize_worker_url(env("WORKER_URL"))
    secret = env("PROBE_SECRET")
    tracker_ip = env("TRACKER_IP")

    timeout = float(env("REQUEST_TIMEOUT_SECONDS", "10"))
    dns_host = env("DNS_HOST", "1.1.1.1")
    https_url = env("HTTPS_CHECK_URL", "https://1.1.1.1/cdn-cgi/trace")
    public_ip_url = env("PUBLIC_IP_URL", "http://ipv4.icanhazip.com")
    internet_url = env("INTERNET_CHECK_URL", "https://cloudflare.com/cdn-cgi/trace")
    api_token = os.environ.get("SPEEDTEST_API_TOKEN", "")
    traceroute_target = os.environ.get("TRACEROUTE_TARGET", "1.1.1.1")
    traceroute_max_hops = env_int("TRACEROUTE_MAX_HOPS", 8)
    traceroute_interval = env_int("TRACEROUTE_INTERVAL_SECONDS", 900)
    traceroute_timeout = float(os.environ.get("TRACEROUTE_TIMEOUT_SECONDS", "45"))

    payload = build_payload(
        isp_id=isp_id,
        dns_host=dns_host,
        https_url=https_url,
        public_ip_url=public_ip_url,
        internet_url=internet_url,
        tracker_ip=tracker_ip,
        api_token=api_token,
        timeout=timeout,
        traceroute_target=traceroute_target,
        traceroute_max_hops=traceroute_max_hops,
        traceroute_interval=traceroute_interval,
        traceroute_timeout=traceroute_timeout,
    )
    post_heartbeat(worker_url, secret, payload, timeout)


def main() -> None:
    required = ("ISP_ID", "PROBE_IP", "TRACKER_IP", "WORKER_URL", "PROBE_SECRET")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit("Missing configuration: " + ", ".join(missing))

    interval = env_int("CHECK_INTERVAL_SECONDS", 60)
    print(f"Starting probe for {os.environ['ISP_ID']} (interval={interval}s)", flush=True)

    while True:
        started = time.monotonic()
        try:
            run_once()
            print(f"[{utc_now()}] heartbeat sent", flush=True)
        except Exception as error:  # noqa: BLE001 - keep probe alive on transient failures
            print(f"[{utc_now()}] heartbeat error: {error}", file=sys.stderr, flush=True)

        elapsed = time.monotonic() - started
        sleep_for = max(1, interval - int(elapsed))
        time.sleep(sleep_for)


if __name__ == "__main__":
    main()
