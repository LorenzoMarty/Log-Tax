"""Outgoing webhooks (#176): destination check against SSRF, HMAC signature, one delivery.

A webhook URL is chosen by a customer, so it is untrusted input that makes the server open a connection. `check_target` accepts
only https on port 443, no credentials, and a host whose every address is public (loopback, private, link-local such as the
cloud metadata address, and reserved ranges are refused). Delivery checks again right before sending and never follows a
redirect, so a destination cannot bounce the request to an internal address.

Delivery pins the connection: the name is resolved once, that answer is validated, and the request goes to that very IP with
the original Host header and TLS SNI/certificate name, so a second DNS answer (rebinding) cannot redirect it. The response body is
never read (only the status), which bounds its size, and the secret never reaches a log line.

Each body is signed: `X-LogTax-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`, with the timestamp in `X-LogTax-Timestamp`
so the receiver can reject replays.
"""

import asyncio
import hashlib
import hmac
import ipaddress
import json
import socket
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.core.logging import log

EVENTS = ("document_uploaded", "member_joined", "regime_changed", "rule_changed")
_BAD_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home", ".corp")


async def resolve_host(host: str) -> list[str]:
    """Every address the name resolves to (empty when it does not resolve)."""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError:
        return []
    return sorted({str(info[4][0]) for info in infos})


def _public(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%")[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


async def resolve_target(url: str) -> tuple[str | None, str, str]:
    """One resolution: `(reason, host, ip)`. `reason` is None when safe; `ip` is then the address to connect to."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return "Endereço inválido.", "", ""
    host = (parts.hostname or "").rstrip(".").lower()
    if parts.scheme != "https" or not host:
        return "Use um endereço https.", host, ""
    if parts.username or parts.password:
        return "O endereço não pode ter usuário ou senha.", host, ""
    if port not in (None, 443):
        return "Use a porta padrão (443).", host, ""
    if host == "localhost" or host.endswith(_BAD_SUFFIXES):
        return "Esse endereço não é público.", host, ""
    try:
        literal = [str(ipaddress.ip_address(host))]
    except ValueError:
        literal = []
    addresses = literal or await resolve_host(host)
    if not addresses:
        return "Não consegui resolver esse endereço.", host, ""
    if not all(_public(a) for a in addresses):
        return "Esse endereço não é público.", host, ""
    return None, host, addresses[0]


async def check_target(url: str) -> str | None:
    """None when the destination is safe to call, otherwise the reason (in Portuguese, safe to show)."""
    return (await resolve_target(url))[0]


def sign(secret: str, timestamp: int, body: bytes) -> str:
    digest = hmac.new(secret.encode(), str(timestamp).encode() + b"." + body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


async def deliver(
    url: str, secret: str, event: str, data: dict[str, Any], http: httpx.AsyncClient, now: int | None = None
) -> bool:
    """One signed POST. True only for a 2xx answer; a refused destination, a redirect or a network error is False."""
    reason, host, ip = await resolve_target(url)
    if reason:
        log.warning("webhook_target_refused", extra={"event": event})
        return False
    timestamp = int(time.time()) if now is None else now
    body = json.dumps({"event": event, "timestamp": timestamp, "data": data}, separators=(",", ":"), sort_keys=True).encode()
    headers = {
        "content-type": "application/json",
        "x-logtax-event": event,
        "x-logtax-timestamp": str(timestamp),
        "x-logtax-signature": sign(secret, timestamp, body),
    }
    parts = urlsplit(url)
    pinned = parts._replace(netloc=f"[{ip}]" if ":" in ip else ip).geturl()
    headers["host"] = host
    try:
        async with http.stream(
            "POST",
            pinned,
            content=body,
            headers=headers,
            timeout=5,
            follow_redirects=False,
            extensions={"sni_hostname": host},
        ) as response:
            return 200 <= response.status_code < 300  # the body is never read
    except httpx.HTTPError:
        return False
