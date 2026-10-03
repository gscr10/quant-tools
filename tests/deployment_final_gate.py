#!/usr/bin/env python3
"""Smoke-test a real deployment and an optional previous/rollback slot.

The check is intentionally environment-driven.  With no QUANT_DEPLOY_URL it
exits 2 (not pass), so local CI cannot accidentally masquerade as an online
deployment verification.
"""

from __future__ import annotations

import json
import os
import re
import sys
from urllib.parse import urljoin, urlparse

from playwright.sync_api import sync_playwright


def required_url(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for the real deployment gate")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError(f"{name} must be an absolute http(s) URL")
    return value.rstrip("/")


def check_slot(page, url: str, label: str) -> dict[str, object]:
    origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    errors: list[str] = []
    blocked: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def route_request(route) -> None:
        host = urlparse(route.request.url).hostname or ""
        if host in {"app.luxalgo.com", "vela.luxalgo.com"}:
            blocked.append(route.request.url)
            route.abort()
            return
        route.continue_()

    page.route("**/*", route_request)
    response = page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    if response is None or response.status != 200:
        raise RuntimeError(f"{label}: entry returned {response.status if response else 'no response'}")
    page.wait_for_selector("#app", timeout=30_000)
    page.wait_for_timeout(500)

    cache_control = response.headers.get("cache-control", "").lower()
    if not all(token in cache_control for token in ("no-cache", "no-store", "must-revalidate")):
        raise RuntimeError(f"{label}: entry cache policy is {cache_control!r}")

    # Read the response body rather than the live DOM: Vite removes the
    # original module tags after execution in some browser versions.
    entry_http = page.request.get(url, timeout=30_000)
    html = entry_http.text()
    assets = sorted(set(re.findall(r"(?:src|href)=['\"]([^'\"]*/assets/[^'\"]+)['\"]", html)))
    asset_results = []
    for asset in assets:
        asset_url = urljoin(origin + "/", asset)
        asset_response = page.request.get(asset_url, timeout=30_000)
        if asset_response.status != 200:
            raise RuntimeError(
                f"{label}: asset returned HTTP {asset_response.status}: {asset_url}"
            )
        asset_cache = asset_response.headers.get("cache-control", "").lower()
        hashed = bool(re.search(r"/assets/[^/]+-[A-Za-z0-9_-]+\.[^/?#]+$", asset_url))
        if hashed and not ("immutable" in asset_cache and "max-age=" in asset_cache):
            raise RuntimeError(f"{label}: hashed asset cache policy is {asset_cache!r}: {asset_url}")
        asset_results.append({"url": asset_url, "status": asset_response.status, "cacheControl": asset_cache})

    if errors:
        raise RuntimeError(f"{label}: page errors: {errors}")
    if blocked:
        raise RuntimeError(f"{label}: reference-site requests detected: {blocked}")
    return {"label": label, "url": url, "entryCacheControl": cache_control, "assets": asset_results, "origin": origin}


def main() -> int:
    try:
        candidate = required_url("QUANT_DEPLOY_URL")
    except RuntimeError as error:
        print(json.dumps({"status": "not_run", "reason": str(error)}))
        return 2
    previous = os.environ.get("QUANT_PREVIOUS_URL", "").strip()
    if previous:
        previous = required_url("QUANT_PREVIOUS_URL")
        if previous == candidate:
            raise RuntimeError("QUANT_PREVIOUS_URL must be different from QUANT_DEPLOY_URL")
    urls = [(candidate, "candidate")]
    if previous:
        urls.append((previous, "previous/rollback"))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        results = [check_slot(page, url, label) for url, label in urls]
        browser.close()
    print(json.dumps({"status": "passed", "slots": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI reports a failing gate.
        print(json.dumps({"status": "failed", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
