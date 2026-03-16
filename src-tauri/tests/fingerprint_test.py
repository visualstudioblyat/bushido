"""
Bushido Fingerprint Integrity Test — Automated Pre-Ship Verification

Two modes:
  --quick (default): Headless Edge + CDP injection. Tests JS in isolation. ~10s.
  --full: Builds & launches actual Bushido binary. Tests real WebView2 pipeline. ~90s.

Usage:
    pip install websockets aiohttp
    python tests/fingerprint_test.py          # quick
    python tests/fingerprint_test.py --full   # full browser
"""

import asyncio
import json
import os
import sys
import subprocess
import socket
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

EDGE_PATHS = [
    os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
    os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(SCRIPT_DIR, '..', 'src')
PROJECT_DIR = os.path.join(SCRIPT_DIR, '..', '..')
APPDATA_DIR = os.path.join(os.environ.get("APPDATA", ""), "app.bushido-browser.desktop")
REPORT_PATH = os.path.join(APPDATA_DIR, "fp-verify-report.json")
SESSION_PATH = os.path.join(APPDATA_DIR, "session.json")


def find_edge():
    for p in EDGE_PATHS:
        if os.path.exists(p):
            return p
    return None


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def read_script(name):
    with open(os.path.join(SRC_DIR, name), 'r', encoding='utf-8') as f:
        return f.read()


_msg_counter = 0
async def cdp_send(ws, method, params=None):
    global _msg_counter
    _msg_counter += 1
    msg_id = _msg_counter
    cmd = {"id": msg_id, "method": method}
    if params:
        cmd["params"] = params
    await ws.send(json.dumps(cmd))
    while True:
        resp = await asyncio.wait_for(ws.recv(), timeout=30)
        data = json.loads(resp)
        if data.get("id") == msg_id:
            if "error" in data:
                raise RuntimeError(f"CDP error in {method}: {data['error']}")
            return data.get("result", {})


def print_report(report):
    passed = report.get("passed", 0)
    failed = report.get("failed", 0)
    total = report.get("total", 0)
    pct = report.get("percentage", 0)
    url = report.get("url", "?")

    print(f"\nResults: {passed}/{total} passed ({pct}%) on {url}\n")

    for r in report.get("results", []):
        if r["pass"]:
            print(f"  \033[32mPASS\033[0m {r['name']}")
        else:
            print(f"  \033[31mFAIL\033[0m {r['name']}")
            print(f"       {r.get('detail', '')}")

    print()
    if failed == 0:
        print(f"\033[32m  ALL {total} ASSERTIONS PASSED\033[0m")
    else:
        print(f"\033[31m  {failed} ASSERTION(S) FAILED — DO NOT SHIP\033[0m")
    print("=" * 60)
    return 0 if failed == 0 else 1


# ═══════════════════════════════════════════════════════════════
# QUICK MODE
# ═══════════════════════════════════════════════════════════════

async def run_quick():
    try:
        import websockets
        import aiohttp
    except ImportError:
        print("ERROR: pip install websockets aiohttp")
        return 2

    edge = find_edge()
    if not edge:
        print("ERROR: Edge not found")
        return 2

    port = find_free_port()
    fingerprint_js = read_script('fingerprint.js')
    verify_js = read_script('fingerprint_verify.js')

    print("=" * 60)
    print("  BUSHIDO FP TEST — QUICK (headless Edge)")
    print("=" * 60)

    proc = subprocess.Popen([
        edge, f"--remote-debugging-port={port}", "--headless=new",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "--disable-component-extensions-with-background-pages",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    ws_url = None
    for _ in range(30):
        try:
            async with aiohttp.ClientSession() as http:
                async with http.get(f"http://127.0.0.1:{port}/json/version", timeout=aiohttp.ClientTimeout(total=2)) as resp:
                    v = await resp.json()
                    ws_url = v.get("webSocketDebuggerUrl")
                    if ws_url:
                        print(f"Browser: {v.get('Browser', '?')}")
                        break
        except:
            pass
        await asyncio.sleep(0.5)

    if not ws_url:
        proc.kill()
        print("ERROR: CDP not available")
        return 2

    page_ws = None
    try:
        async with aiohttp.ClientSession() as http:
            async with http.get(f"http://127.0.0.1:{port}/json") as resp:
                for t in await resp.json():
                    if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                        page_ws = t["webSocketDebuggerUrl"]
                        break
    except:
        pass

    try:
        import websockets
        async with websockets.connect(page_ws or ws_url, max_size=10_000_000) as ws:
            await cdp_send(ws, "Runtime.enable")
            await cdp_send(ws, "Page.enable")
            await cdp_send(ws, "Page.navigate", {"url": "https://example.com"})
            await asyncio.sleep(3)

            await cdp_send(ws, "Runtime.evaluate", {"expression": fingerprint_js, "returnByValue": True})

            verify_immediate = verify_js.replace("}, 1500);", "}, 0);")
            await cdp_send(ws, "Runtime.evaluate", {"expression": verify_immediate, "returnByValue": True})

            await cdp_send(ws, "Runtime.evaluate", {
                "expression": "new Promise(r => setTimeout(r, 2000))",
                "awaitPromise": True, "returnByValue": True
            })

            result = await cdp_send(ws, "Runtime.evaluate", {
                "expression": "JSON.stringify(window.__bushidoVerifyReport || null)",
                "returnByValue": True
            })
            val = result.get("result", {}).get("value")

            if not val or val == "null":
                print("ERROR: No report produced")
                proc.kill()
                return 2

            proc.kill()
            return print_report(json.loads(val))
    except Exception as e:
        print(f"ERROR: {e}")
        proc.kill()
        return 2


# ═══════════════════════════════════════════════════════════════
# FULL MODE: Real Bushido binary
# ═══════════════════════════════════════════════════════════════

async def run_full():
    print("=" * 60)
    print("  BUSHIDO FP TEST — FULL (actual browser)")
    print("=" * 60)

    # Delete old report
    try:
        os.remove(REPORT_PATH)
    except:
        pass

    # Write a session.json that opens example.com so verify fires on launch
    original_session = None
    if os.path.exists(SESSION_PATH):
        with open(SESSION_PATH, 'r', encoding='utf-8') as f:
            original_session = f.read()

    test_session = json.dumps({
        "workspaces": [{"id": "ws-test", "name": "Test", "color": "#6366f1", "activeTabId": "tab-fptest"}],
        "tabs": [{"id": "tab-fptest", "url": "https://example.com", "title": "FP Test", "workspaceId": "ws-test", "pinned": False}],
        "activeWorkspaceId": "ws-test",
        "compactMode": False,
        "panels": [],
        "paneLayout": {"type": "leaf", "tabId": "tab-fptest"}
    })
    os.makedirs(os.path.dirname(SESSION_PATH), exist_ok=True)
    with open(SESSION_PATH, 'w', encoding='utf-8') as f:
        f.write(test_session)

    print("Session: wrote test session (example.com)")

    # Build
    print("Building...")
    build = subprocess.run(
        ["cargo", "build"], cwd=os.path.join(PROJECT_DIR, "src-tauri"),
        capture_output=True, text=True, timeout=300
    )
    if build.returncode != 0:
        print(f"Build failed:\n{build.stderr[-500:]}")
        return 2
    print("Build OK")

    # Need to also build frontend for the binary to work
    print("Building frontend...")
    frontend = subprocess.run(
        ["cmd", "/c", "npm", "run", "build"], cwd=PROJECT_DIR,
        capture_output=True, text=True, timeout=120, shell=True
    )
    if frontend.returncode != 0:
        print(f"Frontend build failed:\n{frontend.stderr[-500:]}")
        # Try anyway, dist might already exist

    binary = os.path.join(PROJECT_DIR, "src-tauri", "target", "debug", "bushido-browser.exe")
    if not os.path.exists(binary):
        print(f"ERROR: Binary not found at {binary}")
        return 2

    print(f"Launching: {binary}")
    app_proc = subprocess.Popen(
        [binary], stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=PROJECT_DIR
    )

    # Wait for report file
    print("Waiting for verify report...\n")
    found = False
    for i in range(120):
        if os.path.exists(REPORT_PATH):
            mtime = os.path.getmtime(REPORT_PATH)
            if time.time() - mtime < 120:
                found = True
                break
        await asyncio.sleep(1)
        if i % 15 == 14:
            print(f"  {i+1}s...")

    # Capture stdout
    try:
        app_proc.terminate()
        stdout, stderr = app_proc.communicate(timeout=5)
        for line in (stdout + stderr).decode('utf-8', errors='replace').split('\n'):
            if 'FP-VERIFY' in line:
                print(f"  [Rust] {line.strip()}")
    except:
        try:
            app_proc.kill()
        except:
            pass

    # Restore original session
    if original_session:
        with open(SESSION_PATH, 'w', encoding='utf-8') as f:
            f.write(original_session)
        print("Session: restored original")
    else:
        try:
            os.remove(SESSION_PATH)
        except:
            pass

    if not found:
        print("ERROR: No report after 120s")
        print(f"  Looked at: {REPORT_PATH}")
        return 2

    with open(REPORT_PATH, 'r', encoding='utf-8') as f:
        report = json.load(f)

    return print_report(report)


def main():
    mode = "--full" if "--full" in sys.argv else "--quick"
    if mode == "--full":
        sys.exit(asyncio.run(run_full()))
    else:
        sys.exit(asyncio.run(run_quick()))


if __name__ == "__main__":
    main()
