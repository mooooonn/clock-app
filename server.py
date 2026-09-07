#!/usr/bin/env python3
"""
Clock App - serve statici + API JSON per stato condiviso.
Nessuna dipendenza esterna (solo stdlib).

Uso:
  python3 server.py                  # porta 8765, bind 0.0.0.0
  PORT=9000 BIND=100.88.128.85 python3 server.py

Storage: state.json accanto al server (backup: cp state.json state.json.bak).
"""

import http.server
import json
import os
import socketserver
import threading
from pathlib import Path

ROOT       = Path(__file__).parent.resolve()
STATE_DIR  = Path(os.environ.get('STATE_DIR', str(ROOT))).resolve()
STATE_DIR.mkdir(parents=True, exist_ok=True)
STATE_FILE = STATE_DIR / 'state.json'
PORT       = int(os.environ.get('PORT', '8765'))
BIND       = os.environ.get('BIND', '0.0.0.0')

_lock = threading.Lock()

EMPTY_STATE = {
    "auth":     {"users": []},
    "sessions": [],
    "goals":    [],
    "tasks":    [],
    "daysOff":  {},
}


def read_state():
    with _lock:
        if not STATE_FILE.exists():
            return EMPTY_STATE
        try:
            with STATE_FILE.open('r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return EMPTY_STATE


def write_state(state):
    with _lock:
        tmp = STATE_FILE.with_suffix('.json.tmp')
        with tmp.open('w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        tmp.replace(STATE_FILE)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.rstrip('/') == '/api/state':
            self._json(200, read_state())
            return
        # Fallback: file statici (index.html, styles.css, app.js)
        # Disabilita caching aggressivo per dev
        super().do_GET()

    def do_PUT(self):
        if self.path.rstrip('/') == '/api/state':
            length = int(self.headers.get('Content-Length', '0') or '0')
            if length <= 0 or length > 20 * 1024 * 1024:
                self.send_error(400, 'Invalid body length')
                return
            body = self.rfile.read(length)
            try:
                state = json.loads(body.decode('utf-8'))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_error(400, 'Invalid JSON')
                return
            if not isinstance(state, dict) or 'auth' not in state:
                self.send_error(400, 'Missing auth')
                return
            write_state(state)
            self.send_response(204)
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return
        self.send_error(405, 'Method not allowed')

    def end_headers(self):
        # No-cache di default, altrimenti browser tiene vecchi css/js in cache
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Log conciso su stderr
        try:
            print(f'[{self.log_date_time_string()}] {self.address_string()} {fmt % args}',
                  flush=True)
        except Exception:
            pass


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    print(f'Clock App server')
    print(f'  root  : {ROOT}')
    print(f'  state : {STATE_FILE}')
    print(f'  bind  : http://{BIND}:{PORT}', flush=True)
    with ThreadingHTTPServer((BIND, PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nShutting down.')


if __name__ == '__main__':
    main()
