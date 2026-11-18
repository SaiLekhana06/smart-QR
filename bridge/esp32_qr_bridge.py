#!/usr/bin/env python3
"""
SmartQR ESP32 Personal Hotspot Wi-Fi Bridge
============================================
Communicates with the ESP32 over its Personal Hotspot / Wi-Fi HTTP endpoint
(no serial port, no COM port, and no baud rate required).

Workflow:
1. Checks reachability of the ESP32 Personal Hotspot URL (e.g. http://192.168.4.1).
2. Sends heartbeats to SmartQR backend with hotspot status.
3. Only when ESP32 is reachable, atomically claims the next PENDING QR job
   from SmartQR backend (`POST /api/esp32/jobs/claim`).
4. Reports IN_PROGRESS and dispatches the signed QR payload over Wi-Fi HTTP
   to the ESP32 hotspot endpoint (0.96" OLED + TTL thermal printer).
5. Reports COMPLETED or FAILED back to SmartQR backend.

Security:
- Only transmits the signed QR payload string (never batch numbers, HMAC keys,
  or admin credentials).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import time
from typing import Optional
from urllib.parse import quote

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("esp32-hotspot-bridge")


class SmartQrBackendClient:
    def __init__(
        self,
        base_url: str,
        api_token: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_token = api_token.strip() if api_token else None
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.bearer_token: Optional[str] = self.api_token

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"
        return headers

    def ensure_authenticated(self) -> None:
        if self.api_token:
            self.bearer_token = self.api_token
            return
        if not self.username or not self.password:
            raise RuntimeError(
                "Bridge authentication requires BRIDGE_API_TOKEN (--token) or admin --username / --password."
            )
        resp = self.session.post(
            f"{self.base_url}/api/auth/login",
            json={"username": self.username, "password": self.password},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("token"):
            self.bearer_token = data["token"]
        log.info("Authenticated with SmartQR backend as %s", data.get("username", self.username))

    def _request_with_reauth(self, method: str, path: str, payload: dict) -> requests.Response:
        url = f"{self.base_url}{path}"
        resp = self.session.request(method, url, json=payload, headers=self._headers(), timeout=10)
        if resp.status_code == 401 and not self.api_token and self.username and self.password:
            self.ensure_authenticated()
            resp = self.session.request(method, url, json=payload, headers=self._headers(), timeout=10)
        resp.raise_for_status()
        return resp

    def send_heartbeat(
        self,
        device_id: str,
        hotspot_url: str,
        esp32_connected: bool,
        last_error: Optional[str] = None,
        firmware_info: Optional[str] = None,
    ) -> None:
        self._request_with_reauth(
            "POST",
            "/api/esp32/heartbeat",
            {
                "deviceId": device_id,
                "hotspotUrl": hotspot_url,
                "bridgeConnected": True,
                "esp32Connected": esp32_connected,
                "lastError": last_error,
                "firmwareInfo": firmware_info,
            },
        )

    def claim_next_job(self, device_id: str) -> Optional[dict]:
        resp = self._request_with_reauth(
            "POST",
            "/api/esp32/jobs/claim",
            {"deviceId": device_id},
        )
        return resp.json().get("job")

    def report_job_status(
        self,
        job_id: str,
        status: str,
        device_id: str,
        error_message: Optional[str] = None,
    ) -> None:
        body: dict[str, object] = {"status": status, "deviceId": device_id}
        if error_message:
            body["errorMessage"] = error_message

        for attempt in range(3):
            try:
                self._request_with_reauth(
                    "POST",
                    f"/api/esp32/jobs/{job_id}/status",
                    body,
                )
                return
            except requests.RequestException as exc:
                if attempt == 2:
                    raise
                log.warning("Transient HTTP error reporting %s (%s); retrying...", status, exc)
                time.sleep(1.0)


def check_esp32_hotspot(
    esp32_session: requests.Session,
    esp32_url: str,
    health_path: str,
    timeout: float = 3.0,
) -> tuple[bool, Optional[str]]:
    target = f"{esp32_url.rstrip('/')}/{health_path.lstrip('/')}"
    try:
        resp = esp32_session.get(target, timeout=timeout)
        if resp.status_code < 500:
            return (True, None)
        return (False, f"ESP32 hotspot returned HTTP {resp.status_code}")
    except requests.RequestException as exc:
        return (False, f"ESP32 hotspot unreachable at {esp32_url}: {exc}")


def interpret_esp32_http_response(resp: requests.Response) -> tuple[bool, str]:
    text = (resp.text or "").strip()
    if resp.status_code >= 400:
        return (False, f"ESP32 HTTP {resp.status_code}: {text or 'Request failed'}")

    if text.startswith("{") and text.endswith("}"):
        try:
            obj = json.loads(text)
            status = str(obj.get("status", "")).upper()
            if obj.get("ok") is False or status in {"FAILED", "ERROR", "ERR"}:
                return (False, str(obj.get("error") or obj.get("message") or text))
            if obj.get("ok") is True or status in {"COMPLETED", "PRINTED", "OK", "DONE", "SUCCESS"}:
                return (True, str(obj.get("message") or text))
        except json.JSONDecodeError:
            pass

    lowered = text.lower()
    if lowered.startswith(("err", "fail", "error", "nack")):
        return (False, text)

    return (True, text or f"HTTP {resp.status_code} OK")


def dispatch_job_over_hotspot(
    esp32_session: requests.Session,
    client: SmartQrBackendClient,
    job: dict,
    esp32_url: str,
    endpoint_path: str,
    http_method: str,
    device_id: str,
    ack_timeout: float,
) -> bool:
    job_id = job["jobId"]
    payload_text = job["payloadText"]
    qr_id = job["qrId"]
    product_id = job["productId"]
    target_url = f"{esp32_url.rstrip('/')}/{endpoint_path.lstrip('/')}"

    log.info("Claimed job %s | Product=%s | QR=%s", job_id, product_id, qr_id)

    try:
        client.report_job_status(job_id, "IN_PROGRESS", device_id)
    except Exception as exc:
        log.warning("Could not mark job %s IN_PROGRESS: %s", job_id, exc)

    try:
        if http_method == "post-json":
            resp = esp32_session.post(
                target_url,
                json={
                    "jobId": job_id,
                    "qrId": qr_id,
                    "productId": product_id,
                    "payload": payload_text,
                },
                timeout=ack_timeout,
            )
        elif http_method == "post-form":
            resp = esp32_session.post(
                target_url,
                data={
                    "jobId": job_id,
                    "qrId": qr_id,
                    "productId": product_id,
                    "payload": payload_text,
                },
                timeout=ack_timeout,
            )
        elif http_method == "post-raw":
            resp = esp32_session.post(
                target_url,
                data=payload_text.encode("utf-8"),
                headers={"Content-Type": "text/plain; charset=utf-8"},
                timeout=ack_timeout,
            )
        else:  # get-query
            sep = "&" if "?" in target_url else "?"
            resp = esp32_session.get(
                f"{target_url}{sep}payload={quote(payload_text, safe='')}",
                timeout=ack_timeout,
            )
    except requests.RequestException as exc:
        err = f"Wi-Fi HTTP transfer to ESP32 hotspot failed: {exc}"
        log.error("Job %s: %s", job_id, err)
        client.report_job_status(job_id, "FAILED", device_id, err)
        return False

    ok, detail = interpret_esp32_http_response(resp)
    if ok:
        client.report_job_status(job_id, "COMPLETED", device_id)
        log.info("Job %s COMPLETED on ESP32 hotspot (%s): %s", job_id, esp32_url, detail)
        return True

    log.error("Job %s FAILED on ESP32 hotspot: %s", job_id, detail)
    client.report_job_status(job_id, "FAILED", device_id, detail)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="SmartQR ESP32 Personal Hotspot Wi-Fi Bridge")
    parser.add_argument(
        "--backend-url",
        default=os.environ.get("SMARTQR_BACKEND_URL", "http://localhost:3000"),
        help="SmartQR backend URL (default: http://localhost:3000)",
    )
    parser.add_argument(
        "--esp32-url",
        default=os.environ.get("ESP32_HOTSPOT_URL", "http://192.168.4.1"),
        help="ESP32 Personal Hotspot base HTTP URL (default: http://192.168.4.1)",
    )
    parser.add_argument(
        "--esp32-endpoint",
        default=os.environ.get("ESP32_ENDPOINT_PATH", "/generate"),
        help="ESP32 HTTP path that accepts QR payload (default: /generate)",
    )
    parser.add_argument(
        "--esp32-health",
        default=os.environ.get("ESP32_HEALTH_PATH", "/"),
        help="ESP32 HTTP path polled to verify hotspot connectivity (default: /)",
    )
    parser.add_argument(
        "--esp32-method",
        choices=("post-json", "post-form", "post-raw", "get-query"),
        default=os.environ.get("ESP32_HTTP_METHOD", "post-json"),
        help="HTTP request format expected by your ESP32 hotspot server (default: post-json)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("BRIDGE_API_TOKEN", ""),
        help="Shared bridge token matching backend BRIDGE_API_TOKEN env var",
    )
    parser.add_argument(
        "--username",
        default=os.environ.get("ADMIN_USERNAME", "admin"),
        help="Admin username if BRIDGE_API_TOKEN is not used",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("ADMIN_PASSWORD", ""),
        help="Admin password if BRIDGE_API_TOKEN is not used",
    )
    parser.add_argument(
        "--device-id",
        default=os.environ.get("ESP32_DEVICE_ID", "ESP32-HOTSPOT"),
        help="Device identifier reported in print logs and status",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=1.5,
        help="Seconds between backend job queue polls (default: 1.5)",
    )
    parser.add_argument(
        "--heartbeat-interval",
        type=float,
        default=5.0,
        help="Seconds between backend heartbeats (default: 5.0)",
    )
    parser.add_argument(
        "--ack-timeout",
        type=float,
        default=30.0,
        help="Seconds to wait for ESP32 HTTP print confirmation (default: 30.0)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Check hotspot, process at most one pending job, and exit cleanly.",
    )
    args = parser.parse_args()

    running = True

    def handle_signal(_sig: int, _frame: object) -> None:
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    client = SmartQrBackendClient(
        base_url=args.backend_url,
        api_token=args.token or None,
        username=args.username or None,
        password=args.password or None,
    )

    try:
        client.ensure_authenticated()
    except Exception as exc:
        log.error("Authentication setup failed: %s", exc)
        return 1

    esp32_session = requests.Session()
    last_heartbeat = 0.0
    last_reachable: Optional[bool] = None

    log.info(
        "Starting ESP32 Personal Hotspot bridge -> backend=%s esp32=%s%s method=%s",
        args.backend_url,
        args.esp32_url,
        args.esp32_endpoint,
        args.esp32_method,
    )

    try:
        while running:
            reachable, reach_err = check_esp32_hotspot(
                esp32_session, args.esp32_url, args.esp32_health
            )
            if reachable != last_reachable:
                if reachable:
                    log.info("Connected to ESP32 Personal Hotspot at %s", args.esp32_url)
                else:
                    log.warning("%s", reach_err)
                last_reachable = reachable

            now = time.monotonic()
            if now - last_heartbeat >= args.heartbeat_interval:
                try:
                    client.send_heartbeat(
                        device_id=args.device_id,
                        hotspot_url=args.esp32_url,
                        esp32_connected=reachable,
                        last_error=reach_err,
                    )
                    last_heartbeat = now
                except Exception as exc:
                    log.warning("Heartbeat failed: %s", exc)

            if reachable:
                try:
                    job = client.claim_next_job(args.device_id)
                except Exception as exc:
                    log.warning("Failed to poll backend job queue: %s", exc)
                    job = None

                if job:
                    dispatch_job_over_hotspot(
                        esp32_session=esp32_session,
                        client=client,
                        job=job,
                        esp32_url=args.esp32_url,
                        endpoint_path=args.esp32_endpoint,
                        http_method=args.esp32_method,
                        device_id=args.device_id,
                        ack_timeout=args.ack_timeout,
                    )
                    if args.once:
                        break
                    continue

            if args.once:
                break

            time.sleep(args.poll_interval)
    finally:
        esp32_session.close()
        log.info("ESP32 Personal Hotspot bridge stopped.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
