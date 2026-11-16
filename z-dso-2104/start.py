#!/usr/bin/env python3
"""
Z-DSO 2104 — local launcher.

Serves this folder over http://localhost (needed for BroadcastChannel
communication between the scope window and your simulator window) and
opens the oscilloscope in your default browser.

Usage:
    python3 start.py [port]
"""
import os
import sys
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def end_headers(self):
        # avoid stale caches while iterating on integration
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter logs
        pass


def main():
    os.chdir(HERE)
    url = f"http://127.0.0.1:{PORT}/index.html"
    print("=" * 58)
    print("  Z-DSO 2104 — Virtual Oscilloscope (local server)")
    print(f"  Osiloskop   : {url}")
    print(f"  Sim demo    : http://127.0.0.1:{PORT}/sim-demo.html")
    print("  Stop        : Ctrl+C")
    print("=" * 58)
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
