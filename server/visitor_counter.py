#!/usr/bin/env python3
import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATABASE_PATH = os.environ.get("VISITOR_DB_PATH", "/var/lib/zmex-visitor/visitors.db")
LISTEN_HOST = os.environ.get("VISITOR_LISTEN_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("VISITOR_LISTEN_PORT", "18181"))
ALLOWED_ORIGINS = {"http://zmex.zstar.website", "https://zmex.zstar.website"}


def open_database():
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.execute("CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)")
    has_visitors = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'visitors'"
    ).fetchone()
    initial_count = connection.execute("SELECT COUNT(*) FROM visitors").fetchone()[0] if has_visitors else 0
    connection.execute("INSERT OR IGNORE INTO counters(name, value) VALUES ('visits', ?)", (initial_count,))
    connection.commit()
    return connection


class VisitorHandler(BaseHTTPRequestHandler):
    server_version = "ZmexVisitorCounter/1.0"

    def do_POST(self):
        if self.path != "/visit":
            self.send_error(404)
            return

        origin = self.headers.get("Origin", "")
        if origin not in ALLOWED_ORIGINS:
            self.send_error(403)
            return

        with open_database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("UPDATE counters SET value = value + 1 WHERE name = 'visits'")
            count = connection.execute("SELECT value FROM counters WHERE name = 'visits'").fetchone()[0]

        body = json.dumps({"count": count}, separators=(",", ":")).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        return


if __name__ == "__main__":
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    with open_database():
        pass
    ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), VisitorHandler).serve_forever()
