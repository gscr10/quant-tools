#!/usr/bin/env python3
"""Deterministic visual, geometry and accessibility gate for the backtest viewer.

This gate intentionally uses the checked-in BTCUSDT fixture rather than the
reference website.  The reference site is not a runtime dependency and its
pixels are not a legal or reproducible golden source for this repository.  A
golden run therefore freezes *our* rendered shell, while the parity matrix
continues to describe which parts still need a reference capture.

Usage::

    python3 tests/visual_a11y_gate.py --update
    python3 tests/visual_a11y_gate.py

The first command is only for an intentional visual-baseline review.  The
normal command fails on a geometry, DOM/a11y, axe-core, keyboard, or pixel
regression. Set ``QUANT_E2E_STARTUP_TIMEOUT`` when the local Vite cold start is
slow.

The runner uses ``tests/vite-performance.config.ts`` so fork bundle rebuilds
performed by another local task cannot hot-reload the fixture while a geometry
or screenshot sample is in progress.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import time
import zlib

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = int(os.environ.get("QUANT_VISUAL_PORT", "4180"))
BASE_URL = f"http://{HOST}:{PORT}/tests/fixtures/backtest-btcusdt.html"
BASELINE_ROOT = ROOT / "tests" / "visual-baseline"
SCREENSHOT_ROOT = BASELINE_ROOT / "screenshots"
GEOMETRY_PATH = BASELINE_ROOT / "geometry.json"
AXE_CORE_PATH = ROOT / "node_modules" / "axe-core" / "axe.min.js"
VIEWPORTS = (
    ("desktop", 1440, 900),
    ("laptop", 1024, 768),
    ("tablet", 768, 900),
    ("mobile", 390, 844),
)


def wait_for_server(process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + float(os.environ.get("QUANT_E2E_STARTUP_TIMEOUT", "90"))
    import urllib.request

    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"Vite exited before startup ({process.returncode}):\n{output}")
        try:
            with urllib.request.urlopen(f"http://{HOST}:{PORT}/", timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:  # noqa: BLE001 - startup probe retries by design.
            time.sleep(0.15)
    raise TimeoutError(f"Vite did not start within {deadline} seconds")


def rgba_from_png(data: bytes) -> tuple[int, int, bytes]:
    """Decode the subset of PNG emitted by Playwright into RGBA rows.

    Keeping this tiny decoder in the test avoids adding a runtime image
    dependency solely for visual regression.  It supports the ordinary
    8-bit RGB/RGBA screenshots and all PNG row filters.
    """

    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos = 8
    width = height = bit_depth = color_type = None
    packed = bytearray()
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += length + 12
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _compression, _filter, _interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
            if bit_depth != 8 or color_type not in (2, 6):
                raise ValueError(f"unsupported PNG format: depth={bit_depth}, type={color_type}")
        elif kind == b"IDAT":
            packed.extend(chunk)
        elif kind == b"IEND":
            break
    if width is None or height is None or bit_depth is None or color_type is None:
        raise ValueError("PNG has no IHDR")
    channels = 4 if color_type == 6 else 3
    stride = width * channels
    raw = zlib.decompress(bytes(packed))
    expected = height * (stride + 1)
    if len(raw) != expected:
        raise ValueError(f"unexpected PNG payload: {len(raw)} != {expected}")
    rows: list[bytes] = []
    cursor = 0
    previous = bytearray(stride)
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        source = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        for index in range(stride):
            left = source[index - channels] if index >= channels else 0
            up = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 1:
                source[index] = (source[index] + left) & 0xFF
            elif filter_type == 2:
                source[index] = (source[index] + up) & 0xFF
            elif filter_type == 3:
                source[index] = (source[index] + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                estimate = left + up - upper_left
                pa = abs(estimate - left)
                pb = abs(estimate - up)
                pc = abs(estimate - upper_left)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else upper_left
                source[index] = (source[index] + predictor) & 0xFF
            elif filter_type != 0:
                raise ValueError(f"unsupported PNG filter {filter_type}")
        previous = source
        if channels == 3:
            expanded = bytearray(width * 4)
            for pixel in range(width):
                expanded[pixel * 4 : pixel * 4 + 3] = source[pixel * 3 : pixel * 3 + 3]
                expanded[pixel * 4 + 3] = 255
            rows.append(bytes(expanded))
        else:
            rows.append(bytes(source))
    return width, height, b"".join(rows)


def compare_png(candidate: bytes, reference: bytes, threshold: int = 2) -> dict[str, float | int]:
    width, height, pixels = rgba_from_png(candidate)
    ref_width, ref_height, ref_pixels = rgba_from_png(reference)
    if (width, height) != (ref_width, ref_height):
        return {
            "width": width,
            "height": height,
            "referenceWidth": ref_width,
            "referenceHeight": ref_height,
            "differentPixels": width * height,
            "ratio": 1.0,
            "maxChannelDelta": 255,
        }
    different_channels = 0
    max_delta = 0
    for left, right in zip(pixels, ref_pixels):
        delta = max(abs(left - right), abs(left - right))
        max_delta = max(max_delta, delta)
        if delta > threshold:
            different_channels += 1
    # Count pixels, rather than channels, so a four-channel difference is
    # not accidentally treated as four times the image area.
    different = sum(
        1
        for offset in range(0, len(pixels), 4)
        if any(abs(pixels[offset + channel] - ref_pixels[offset + channel]) > threshold for channel in range(4))
    )
    total = width * height
    return {
        "width": width,
        "height": height,
        "differentPixels": different,
        "ratio": different / total if total else 0.0,
        "differentChannels": different_channels,
        "maxChannelDelta": max_delta,
    }


def contrast_ratio(foreground: list[float], background: list[float]) -> float:
    def luminance(rgb: list[float]) -> float:
        channels = []
        for value in rgb[:3]:
            normalized = value / 255
            channels.append(normalized / 12.92 if normalized <= 0.04045 else ((normalized + 0.055) / 1.055) ** 2.4)
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722

    light = luminance(foreground)
    dark = luminance(background)
    return (max(light, dark) + 0.05) / (min(light, dark) + 0.05)


def install_offline_guard(context: BrowserContext) -> None:
    def route_handler(route) -> None:
        url = route.request.url
        if url.startswith(f"http://{HOST}:{PORT}") or url.startswith("data:") or url.startswith("blob:"):
            route.continue_()
        else:
            route.abort()

    context.route("**/*", route_handler)


def browser_dom_audit(page: Page) -> dict[str, object]:
    return page.evaluate(
        """
        () => {
          const root = document.querySelector('.quant-backtest-viewer');
          const visible = (node) => {
            if (!(node instanceof HTMLElement)) return false;
            // A hidden Dock/Settings subtree keeps its descendants' own
            // `hidden` flag unset. Walk ancestors so the audit reflects what
            // a user can actually see and focus, while the separate ARIA
            // reference pass below still inspects hidden structural nodes.
            for (let current = node; current instanceof HTMLElement; current = current.parentElement) {
              const style = getComputedStyle(current);
              if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true'
                || style.display === 'none' || style.visibility === 'hidden') return false;
            }
            return true;
          };
          const name = (node) => (node.getAttribute('aria-label') || node.getAttribute('title')
            || node.textContent || '').replace(/\\s+/g, ' ').trim();
          const violations = [];
          const ids = new Map();
          for (const node of document.querySelectorAll('[id]')) ids.set(node.id, (ids.get(node.id) || 0) + 1);
          for (const [id, count] of ids) if (count > 1) violations.push(`duplicate-id:${id}`);
          for (const node of document.querySelectorAll('button, [role="button"], input, select, textarea, [role="tab"], [role="separator"]')) {
            if (visible(node) && !name(node) && !node.getAttribute('aria-labelledby')) violations.push(`unnamed:${node.tagName}.${node.className}`);
          }
          for (const node of document.querySelectorAll('[aria-controls], [aria-labelledby], [aria-describedby]')) {
            for (const attribute of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
              const raw = node.getAttribute(attribute);
              if (!raw) continue;
              for (const id of raw.split(/\\s+/)) if (id && !document.getElementById(id)) violations.push(`missing-${attribute}:${id}`);
            }
          }
          for (const image of document.querySelectorAll('img')) if (visible(image) && !image.alt && image.getAttribute('aria-hidden') !== 'true') violations.push('image-without-alt');
          const focusables = [...(root ? root.querySelectorAll('button, [href], input, select, textarea, [tabindex]') : [])]
            .filter((node) => visible(node) && node.tabIndex >= 0)
            .map((node) => ({ tag: node.tagName, name: name(node), tabIndex: node.tabIndex }));
          const tabs = [...document.querySelectorAll('.quant-backtest-tab')].map((node) => ({ selected: node.getAttribute('aria-selected'), controls: node.getAttribute('aria-controls'), tabIndex: node.tabIndex }));
          const panel = document.querySelector('#quant-backtest-panel');
          const chartDescriptions = [...document.querySelectorAll('.quant-backtest-chart-host, .quant-backtest-analysis-chart-host, .quant-backtest-simulation-chart-host')]
            .filter(visible)
            .map((host) => {
              const svg = host.querySelector('svg');
              const label = host.getAttribute('aria-label') || svg?.getAttribute('aria-label') || svg?.querySelector('desc')?.textContent || '';
              if (!label.trim()) violations.push(`chart-without-description:${host.className}`);
              return { className: host.className, label: label.trim() };
            });
          const contrast = [];
          const parse = (value) => { const match = value.match(/rgba?\\(([^)]+)\\)/); if (!match) return null; const numbers = match[1].split(',').map(Number); return numbers.length >= 3 ? numbers : null; };
          const backgroundFor = (node) => { let current = node; while (current instanceof HTMLElement) { const color = parse(getComputedStyle(current).backgroundColor); if (color && (color[3] === undefined || color[3] > 0)) return color; current = current.parentElement; } return [21, 22, 25]; };
          for (const node of document.querySelectorAll('.quant-backtest-viewer *')) {
            if (!(node instanceof HTMLElement) || !visible(node) || !node.textContent?.trim()) continue;
            // Inspect the element that owns visible text, not every ancestor;
            // this avoids reporting the same inherited color many times.
            const directText = [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join('').trim();
            if (!directText) continue;
            const style = getComputedStyle(node); const fg = parse(style.color); const bg = backgroundFor(node);
            if (!fg || !bg || fg[3] === 0) continue;
            const ratio = ((Math.max(...fg.slice(0, 3)) - Math.min(...fg.slice(0, 3))) < 2 && (Math.max(...bg.slice(0, 3)) - Math.min(...bg.slice(0, 3))) < 2) ? 1 : null;
            const actual = ratio === 1 ? 1 : null;
            // The Python side computes exact WCAG ratios from these samples.
            contrast.push({ text: directText.slice(0, 80), foreground: fg, background: bg, fontSize: parseFloat(style.fontSize), fontWeight: style.fontWeight, ratio: actual, className: node.className });
          }
          return { violations, focusables, tabs, panel: panel ? { labelledby: panel.getAttribute('aria-labelledby'), role: panel.getAttribute('role') } : null, chartDescriptions, contrast };
        }
        """
    )


def python_contrast_audit(dom: dict[str, object]) -> list[dict[str, object]]:
    violations: list[dict[str, object]] = []
    for item in dom.get("contrast", []):
        foreground = item.get("foreground")
        background = item.get("background")
        if not isinstance(foreground, list) or not isinstance(background, list):
            continue
        if len(foreground) > 3 and foreground[3] == 0:
            continue
        ratio = contrast_ratio(foreground, background)
        size = float(item.get("fontSize") or 12)
        weight = str(item.get("fontWeight") or "400")
        large = size >= 18 or (size >= 14 and (weight.isdigit() and int(weight) >= 700))
        minimum = 3.0 if large else 4.5
        if ratio + 0.01 < minimum:
            violations.append({"text": item.get("text", ""), "ratio": round(ratio, 3), "minimum": minimum})
    return violations


def axe_audit(page: Page) -> dict[str, object]:
    """Run the local axe-core dependency without loading remote assets."""

    if not AXE_CORE_PATH.is_file():
        raise FileNotFoundError(
            f"missing local axe-core bundle: {AXE_CORE_PATH}; run npm ci before the visual gate"
        )
    page.add_script_tag(path=str(AXE_CORE_PATH))
    result = page.evaluate(
        """
        async () => {
          if (!window.axe) throw new Error('local axe-core injection did not expose window.axe');
          const scan = await window.axe.run(document, { resultTypes: ['violations'] });
          return {
            version: scan.testEngine?.version || window.axe.version || 'unknown',
            violations: scan.violations.map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              help: violation.help,
              tags: violation.tags,
              nodes: violation.nodes.map((node) => ({
                target: node.target,
                html: node.html.slice(0, 500),
                failureSummary: node.failureSummary,
              })),
            })),
          };
        }
        """
    )
    blocking = [
        violation
        for violation in result["violations"]
        if violation.get("impact") in {"critical", "serious"}
    ]
    assert not blocking, blocking
    return result


def geometry(page: Page) -> dict[str, object]:
    return page.evaluate(
        """
        () => {
          const rect = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
          const styledRect = (node) => {
            if (!node) return null;
            const style = getComputedStyle(node);
            return {
              ...rect(node),
              style: {
                width: style.width,
                maxWidth: style.maxWidth,
                marginLeft: style.marginLeft,
                marginRight: style.marginRight,
                paddingLeft: style.paddingLeft,
                paddingRight: style.paddingRight,
                boxSizing: style.boxSizing,
                borderLeftWidth: style.borderLeftWidth,
                borderRightWidth: style.borderRightWidth,
                borderRadius: style.borderRadius,
              },
            };
          };
          const viewer = document.querySelector('.quant-backtest-viewer');
          const panel = document.querySelector('#quant-backtest-panel');
          const tabList = document.querySelector('.quant-backtest-tabs');
          const contentPage = panel?.querySelector('.quant-backtest-page');
          const logCard = panel?.querySelector('.quant-backtest-log-card');
          const simulationToolbar = panel?.querySelector('.quant-backtest-simulation-toolbar');
          return {
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            page: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight },
            workbench: rect(document.querySelector('.quant-backtest-workbench')),
            dock: rect(document.querySelector('.quant-backtest-dock')),
            viewer: rect(viewer),
            panel: rect(panel),
            contentPage: styledRect(contentPage),
            logCard: styledRect(logCard),
            simulationToolbar: styledRect(simulationToolbar),
            tabs: rect(tabList),
            activeTab: document.querySelector('.quant-backtest-tab[aria-selected="true"]')?.id || null,
            tabScrollWidth: tabList?.scrollWidth || 0,
            panelScrollWidth: panel?.scrollWidth || 0,
            panelClientWidth: panel?.clientWidth || 0,
          };
        }
        """
    )


def assert_geometry(item: dict[str, object], viewport: tuple[str, int, int]) -> None:
    label, width, height = viewport
    page = item["page"]
    assert page["scrollWidth"] <= page["clientWidth"] + 1, (label, page)
    assert page["scrollHeight"] <= page["clientHeight"] + 1, (label, page)
    viewer = item["viewer"]
    assert viewer and viewer["left"] >= -1 and viewer["right"] <= width + 1, (label, viewer)
    assert viewer["top"] >= -1 and viewer["bottom"] <= height + 1, (label, viewer)
    panel = item["panel"]
    assert panel and panel["width"] > 0 and panel["height"] > 0, (label, panel)
    assert item["panelScrollWidth"] >= item["panelClientWidth"], (label, item)
    # At narrow widths the tab strip may scroll horizontally by design; it
    # must never expand the document itself or clip the selected tab's shell.
    assert item["tabs"]["width"] <= width + 1, (label, item["tabs"])


def assert_page_surface_geometry(
    item: dict[str, object],
    viewport: tuple[str, int, int],
    expected_padding: float,
    *,
    require_log_card: bool = False,
    require_toolbar: bool = False,
) -> None:
    """Check the measured report-page/card contract in the active tab.

    The page is deliberately full-width.  Keeping these checks alongside the
    viewport shell assertions catches a reintroduced max-width/auto-margin or
    content-box overflow before it is hidden by a screenshot golden.
    """

    label, _width, _height = viewport
    surface = item.get("contentPage")
    panel = item["panel"]
    assert surface, (label, "missing report page", item)
    assert abs(surface["left"] - panel["left"]) <= 1, (label, surface, panel)
    assert abs(surface["right"] - panel["right"]) <= 1, (label, surface, panel)
    style = surface["style"]
    assert style["boxSizing"] == "border-box", (label, style)
    assert style["maxWidth"] in {"none", "100%"}, (label, style)
    assert style["marginLeft"] == "0px" and style["marginRight"] == "0px", (label, style)
    assert abs(float(style["paddingLeft"].removesuffix("px")) - expected_padding) <= 0.1, (label, style)
    assert abs(float(style["paddingRight"].removesuffix("px")) - expected_padding) <= 0.1, (label, style)
    if require_log_card:
        card = item.get("logCard")
        assert card, (label, "missing log card", item)
        card_style = card["style"]
        assert card_style["borderLeftWidth"] == "1px" and card_style["borderRightWidth"] == "1px", (label, card_style)
        assert card_style["borderRadius"] != "0px", (label, card_style)
        assert card_style["paddingLeft"] == "16px" and card_style["paddingRight"] == "16px", (label, card_style)
    if require_toolbar:
        toolbar = item.get("simulationToolbar")
        assert toolbar, (label, "missing simulation toolbar", item)
        toolbar_style = toolbar["style"]
        assert toolbar_style["marginLeft"] == "0px" and toolbar_style["marginRight"] == "0px", (label, toolbar_style)


def keyboard_audit(page: Page) -> dict[str, object]:
    page.locator('.quant-backtest-tab[aria-selected="true"]').focus()
    page.keyboard.press("ArrowRight")
    right = page.locator('.quant-backtest-tab[aria-selected="true"]').get_attribute("id")
    page.keyboard.press("End")
    end = page.locator('.quant-backtest-tab[aria-selected="true"]').get_attribute("id")
    page.keyboard.press("Home")
    home = page.locator('.quant-backtest-tab[aria-selected="true"]').get_attribute("id")
    page.keyboard.press("Shift+Tab")
    before = page.evaluate("document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.className")
    page.keyboard.press("Tab")
    after = page.evaluate("document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.className")
    # The Viewer uses a roving tabindex for its four report tabs.  Exercise a
    # complete focus-loop lap so a button selector cannot accidentally pull
    # inactive (tabindex=-1) tabs into the programmatic Tab trap.
    page.locator('.quant-backtest-tab[aria-selected="true"]').focus()
    inactive_tab_focus: list[str] = []
    for _ in range(8):
        page.keyboard.press("Tab")
        state = page.evaluate(
            """() => {
              const node = document.activeElement;
              return node?.getAttribute('role') === 'tab'
                && node.getAttribute('aria-selected') !== 'true'
                ? (node.id || node.textContent || 'unnamed-tab')
                : null;
            }"""
        )
        if state:
            inactive_tab_focus.append(state)
    assert not inactive_tab_focus, inactive_tab_focus
    return {
        "arrowRight": right,
        "end": end,
        "home": home,
        "shiftTabFocus": before,
        "tabFocus": after,
        "inactiveTabFocus": inactive_tab_focus,
    }


def run_gate(update: bool) -> dict[str, object]:
    executable = os.environ.get("CHROMIUM_EXECUTABLE")
    if not executable and Path("/Applications/Chromium.app/Contents/MacOS/Chromium").exists():
        executable = "/Applications/Chromium.app/Contents/MacOS/Chromium"
    launch_options: dict[str, object] = {"headless": True}
    if executable:
        launch_options["executable_path"] = executable
    # Invoke Vite directly instead of `npm run dev`: the latter runs the
    # repository's predev fork rebuild hook and can leave the fixture in a
    # transient module state on a cold CI runner. The startup gate already
    # built and checked the fork artifacts; this process should only serve the
    # no-HMR visual harness.
    vite = ROOT / "node_modules/.bin/vite"
    command = [
        str(vite) if vite.exists() else "npx",
        *([] if vite.exists() else ["vite"]),
        "--config", "tests/vite-performance.config.ts",
        "--host", HOST, "--port", str(PORT), "--strictPort",
    ]
    server = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_server(server)
        with sync_playwright() as playwright:
            browser: Browser = playwright.chromium.launch(**launch_options)
            geometry_results: dict[str, object] = {}
            screenshot_results: dict[str, object] = {}
            keyboard_results: dict[str, object] = {}
            a11y_results: dict[str, object] = {}
            for label, width, height in VIEWPORTS:
                context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
                install_offline_guard(context)
                page = context.new_page()
                response = page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
                assert response is not None and response.status == 200
                page.wait_for_function("window.__btcFixture?.ready === true", timeout=60_000)
                # The reference keeps the Dock at 1024px, but replaces it
                # with one compact chart-area Backtest entry at 1023px and
                # below. Exercise the same public entry point in the compact
                # view instead of forcing an invisible Dock button.
                if width <= 1023:
                    mobile_entry = page.locator('.quant-backtest-mobile-trigger')
                    mobile_entry.wait_for(state="visible")
                    assert page.locator('.quant-backtest-dock').is_hidden()
                    mobile_entry.click()
                else:
                    page.locator('.quant-backtest-dock [aria-label="Open backtest viewer"]').click()
                viewer = page.locator('.quant-backtest-viewer')
                viewer.wait_for(state="visible")
                page.wait_for_function("document.fonts?.status === 'loaded'")
                page.wait_for_timeout(700)
                geometry_results[label] = geometry(page)
                assert_geometry(geometry_results[label], (label, width, height))
                assert_page_surface_geometry(
                    geometry_results[label],
                    (label, width, height),
                    16,
                )

                # Capture each report page's surface contract as well as the
                # initial Performance shell.  This keeps the geometry golden
                # useful for the page-specific inline gutters and the Log
                # card, which are not visible at the same time.
                variants: dict[str, object] = {}
                for tab, padding, needs_card, needs_toolbar in (
                    ("analysis", 32, False, False),
                    ("log", 16, True, False),
                    ("simulation", 32, False, width > 1023),
                ):
                    page.locator(f'.quant-backtest-tab[data-tab="{tab}"]').click()
                    page.wait_for_timeout(120)
                    variant = geometry(page)
                    assert_page_surface_geometry(
                        variant,
                        (label, width, height),
                        12 if width <= 640 and tab == "analysis" else (16 if width <= 640 else padding),
                        require_log_card=needs_card,
                        require_toolbar=needs_toolbar,
                    )
                    variants[tab] = {
                        "contentPage": variant["contentPage"],
                        "logCard": variant["logCard"],
                        "simulationToolbar": variant["simulationToolbar"],
                    }
                page.locator('.quant-backtest-tab[data-tab="performance"]').click()
                page.wait_for_timeout(120)
                geometry_results[label]["variants"] = variants
                keyboard_results[label] = keyboard_audit(page)
                dom = browser_dom_audit(page)
                contrast_violations = python_contrast_audit(dom)
                assert not dom["violations"], (label, dom["violations"])
                assert not contrast_violations, (label, contrast_violations)
                axe = axe_audit(page)
                a11y_results[label] = {
                    "violations": dom["violations"],
                    "contrastViolations": contrast_violations,
                    "axe": axe,
                    "focusableCount": len(dom["focusables"]),
                    "tabs": dom["tabs"],
                    "chartDescriptions": dom["chartDescriptions"],
                }
                # Capture stable shell states.  The chart's fallback/Highcharts
                # upgrade is already settled by the fixed wait above.
                for state in ("dock", "performance"):
                    if state == "dock":
                        page.locator('.quant-backtest-viewer [aria-label="Return to chart"]').click()
                        if width <= 1023:
                            page.locator('.quant-backtest-mobile-trigger').wait_for(state="visible")
                            assert page.locator('.quant-backtest-dock').is_hidden()
                        else:
                            page.locator('.quant-backtest-dock').wait_for(state="visible")
                    else:
                        if width <= 1023:
                            page.locator('.quant-backtest-mobile-trigger').click()
                        else:
                            page.locator('.quant-backtest-dock [aria-label="Open backtest viewer"]').click()
                        viewer.wait_for(state="visible")
                    # Dock goldens describe the unfocused shell. Opening or
                    # returning from the dock intentionally leaves the trigger
                    # focused for keyboard users, so clear only that transient
                    # ring before capture; keyboard focus behavior is asserted
                    # separately by keyboard_audit(). Other states retain their
                    # established scroll/focus capture.
                    if state == "dock":
                        page.evaluate("document.activeElement?.blur()")
                    path = SCREENSHOT_ROOT / f"{label}-{state}.png"
                    if update:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(path), animations="disabled")
                    else:
                        assert path.exists(), f"missing visual golden: {path}; run --update after review"
                        candidate = page.screenshot(animations="disabled")
                        screenshot_results[f"{label}-{state}"] = compare_png(candidate, path.read_bytes())
                        assert screenshot_results[f"{label}-{state}"]["ratio"] <= 0.001, (
                            label, state, screenshot_results[f"{label}-{state}"]
                        )
                page.evaluate("window.__btcFixture.destroy()")
                context.close()
            browser.close()
        GEOMETRY_PATH.parent.mkdir(parents=True, exist_ok=True)
        geometry_payload = {"viewports": geometry_results, "viewportMatrix": VIEWPORTS}
        if update:
            GEOMETRY_PATH.write_text(json.dumps(geometry_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        else:
            assert GEOMETRY_PATH.exists(), f"missing geometry golden: {GEOMETRY_PATH}"
            expected = json.loads(GEOMETRY_PATH.read_text(encoding="utf-8"))
            for label, current in geometry_results.items():
                previous = expected["viewports"][label]
                def compare_rect(path: str, candidate: object, baseline: object) -> None:
                    if candidate is None or baseline is None:
                        if candidate != baseline:
                            raise AssertionError(f"geometry drift {label}.{path}: {candidate} != {baseline}")
                        return
                    for coordinate in ("left", "top", "right", "bottom", "width", "height"):
                        if coordinate in candidate and abs(candidate[coordinate] - baseline[coordinate]) > 1.0:
                            raise AssertionError(f"geometry drift {label}.{path}.{coordinate}: {candidate[coordinate]} != {baseline[coordinate]}")

                for field in ("viewer", "panel", "tabs", "contentPage", "logCard", "simulationToolbar"):
                    compare_rect(field, current[field], previous[field])
                for tab, variant in current.get("variants", {}).items():
                    previous_variant = previous.get("variants", {}).get(tab)
                    if previous_variant is None:
                        raise AssertionError(f"missing geometry golden {label}.variants.{tab}")
                    for field in ("contentPage", "logCard", "simulationToolbar"):
                        compare_rect(f"variants.{tab}.{field}", variant[field], previous_variant[field])
        return {"geometry": geometry_results, "screenshots": screenshot_results, "keyboard": keyboard_results, "a11y": a11y_results}
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", action="store_true", help="write reviewed local screenshot/geometry goldens")
    args = parser.parse_args()
    result = run_gate(args.update)
    print(json.dumps(result, indent=2, sort_keys=True))
    print("visual/a11y gate passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - keep a useful CI failure.
        print(f"visual/a11y gate failed: {error}", file=sys.stderr)
        raise
