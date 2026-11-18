#!/usr/bin/env python3
"""Serve Typedef locally. Browsers refuse ES modules from file://.

Usage: python3 serve.py [port]    (default 8000, http://localhost:8000/)
"""
import functools
import http.server
import pathlib
import sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
root = pathlib.Path(__file__).resolve().parent
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
handler.func.extensions_map = {**handler.func.extensions_map, ".js": "text/javascript", ".json": "application/json"}
with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
    print(f"Typedef at http://localhost:{port}/  (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
