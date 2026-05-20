"""Test configuration for server.py tests.

CRITICAL: We must point DATABASE_PATH at a fresh temp file BEFORE importing
`server`, because `rummy5000.app` reads DB_PATH at import time and `server`
calls init_db()/_migrate_db() at import time. We import `server` exactly once
here (after setting the env var) and reuse it across the whole test session.
"""

import os
import tempfile

import pytest

# ── Set up an isolated temp DB BEFORE importing server ───────────────────
_TMP_DB_FD, _TMP_DB_PATH = tempfile.mkstemp(suffix=".db", prefix="doddgames_test_")
os.close(_TMP_DB_FD)
os.environ["DATABASE_PATH"] = _TMP_DB_PATH

# Now it is safe to import server (and the rummy app it pulls in).
import server  # noqa: E402


def _truncate_db():
    """Wipe rows between tests so each test starts from a clean slate."""
    conn = server.sqlite3.connect(server.DB_PATH)
    try:
        conn.execute("DELETE FROM brain_scores")
        conn.execute("DELETE FROM profiles")
        conn.commit()
    finally:
        conn.close()


@pytest.fixture
def client():
    """Fresh Flask test client per test (isolated session cookies)."""
    server.app.testing = True
    # Clear rate-limiter and DB so tests don't interfere with each other.
    server._auth_attempts.clear()
    _truncate_db()
    with server.app.test_client() as c:
        yield c
    server._auth_attempts.clear()


@pytest.fixture
def server_module():
    """Direct access to the imported server module for white-box assertions."""
    return server


def _register(client, username="alice", password="password123", **extra):
    payload = {"username": username, "password": password}
    payload.update(extra)
    return client.post("/api/auth/register", json=payload)


@pytest.fixture
def register():
    return _register


def pytest_sessionfinish(session, exitstatus):
    try:
        os.remove(_TMP_DB_PATH)
    except OSError:
        pass
