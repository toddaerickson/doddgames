"""Unified DoddGames server.

Serves the DoddGames cognitive assessment platform at /
and mounts Rummy 5000 at /rummy5000.

Provides shared authentication (username + password) and
brain-game score APIs so all apps use a single login.
"""

import json
import logging
import os
import re
import sqlite3
import time
from collections import defaultdict
from datetime import timedelta

from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

from rummy5000.app import DB_PATH, init_db, rummy_bp

logger = logging.getLogger(__name__)

# static_folder=None because we serve DoddGames static files via explicit routes
# and Rummy 5000 static files via its own Blueprint
app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get('SECRET_KEY', 'doddgames-dev-key-change-in-production')
if app.secret_key == 'doddgames-dev-key-change-in-production' and not app.debug:
    logger.warning("SECRET_KEY is using the default value — set SECRET_KEY env var in production")

# Sessions persist for 365 days so users stay logged in across browser restarts
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=365)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
if os.environ.get('RAILWAY_ENVIRONMENT') or os.environ.get('HTTPS'):
    app.config['SESSION_COOKIE_SECURE'] = True

# ── Valid game keys (allowlist) ──────────────────────────
VALID_GAME_KEYS = frozenset([
    'schulte', 'tetris', 'stroop', 'trails-a', 'trails-b',
    'gonogo', 'card-sort', 'tower', 'symbol-digit', 'word-list',
    'cpt', 'digit-span', 'nback', 'reversi',
])

# ── Simple rate limiter for auth endpoints ───────────────
_auth_attempts = defaultdict(list)  # ip -> [timestamps]
AUTH_RATE_LIMIT = 10  # max attempts
AUTH_RATE_WINDOW = 300  # per 5 minutes

def _rate_limited(ip):
    now = time.time()
    attempts = _auth_attempts[ip]
    _auth_attempts[ip] = [t for t in attempts if now - t < AUTH_RATE_WINDOW]
    if len(_auth_attempts[ip]) >= AUTH_RATE_LIMIT:
        return True
    _auth_attempts[ip].append(now)
    return False

# ── Color validation ─────────────────────────────────────
_HEX_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')

# Initialize database (creates tables if needed)
init_db()

# Migrate existing DB: add columns introduced after the initial schema.
# Safe to run repeatedly — each ALTER is skipped if the column already exists.
def _migrate_db():
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cols = {row[1] for row in cursor.execute("PRAGMA table_info(profiles)").fetchall()}
        migrations = [
            ('color', "ALTER TABLE profiles ADD COLUMN color TEXT DEFAULT '#7b2ff7'"),
            ('age_bracket', "ALTER TABLE profiles ADD COLUMN age_bracket TEXT DEFAULT ''"),
            ('colorblind', "ALTER TABLE profiles ADD COLUMN colorblind INTEGER DEFAULT 0"),
            ('last_active_at', "ALTER TABLE profiles ADD COLUMN last_active_at TEXT"),
            ('username', "ALTER TABLE profiles ADD COLUMN username TEXT UNIQUE"),
            ('password_hash', "ALTER TABLE profiles ADD COLUMN password_hash TEXT"),
        ]
        for col, sql in migrations:
            if col not in cols:
                cursor.execute(sql)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS brain_scores (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id   INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
                game_key     TEXT NOT NULL,
                data         TEXT NOT NULL,
                display_text TEXT,
                played_at    TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
    except Exception:
        logger.exception("Database migration failed")
        raise
    finally:
        conn.close()

_migrate_db()

# Mark every request's session as permanent so the cookie gets the long expiry
@app.before_request
def make_session_permanent():
    session.permanent = True

# Mount Rummy 5000 blueprint
app.register_blueprint(rummy_bp, url_prefix='/rummy5000')

# ── DoddGames static file serving ─────────────────────

DODDGAMES_ROOT = os.path.dirname(os.path.abspath(__file__))


@app.route('/')
def doddgames_index():
    return send_from_directory(DODDGAMES_ROOT, 'index.html')


@app.route('/manifest.json')
def manifest():
    return send_from_directory(DODDGAMES_ROOT, 'manifest.json')


@app.route('/icon-192.png')
def icon_192():
    return send_from_directory(DODDGAMES_ROOT, 'icon-192.png')


@app.route('/icon-512.png')
def icon_512():
    return send_from_directory(DODDGAMES_ROOT, 'icon-512.png')


@app.route('/css/<path:path>')
def doddgames_css(path):
    return send_from_directory(os.path.join(DODDGAMES_ROOT, 'css'), path)


@app.route('/js/<path:path>')
def doddgames_js(path):
    return send_from_directory(os.path.join(DODDGAMES_ROOT, 'js'), path)


# ── Reversi static file serving ───────────────────────

@app.route('/reversi/')
def reversi_index():
    return send_from_directory(os.path.join(DODDGAMES_ROOT, 'reversi'), 'index.html')


@app.route('/reversi/<path:path>')
def reversi_static(path):
    return send_from_directory(os.path.join(DODDGAMES_ROOT, 'reversi'), path)


# ── Database helper ───────────────────────────────────

def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

# Standard profile columns returned by auth and user endpoints
_PROFILE_COLS = "id, username, name, color, age_bracket, colorblind, created_at, last_active_at"


# ── Authentication API ────────────────────────────────

@app.route('/api/auth/register', methods=['POST'])
def auth_register():
    if _rate_limited(request.remote_addr):
        return jsonify({'error': 'Too many attempts. Please wait a few minutes.'}), 429

    data = request.get_json() or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password', '')
    name = (data.get('name') or '').strip()[:20]
    color = data.get('color', '#7b2ff7')
    if not _HEX_COLOR_RE.match(color):
        color = '#7b2ff7'

    if not username or len(username) < 3:
        return jsonify({'error': 'Username must be at least 3 characters'}), 400
    if len(username) > 20:
        return jsonify({'error': 'Username must be 20 characters or fewer'}), 400
    if not username.isalnum() and not all(c.isalnum() or c in '_-' for c in username):
        return jsonify({'error': 'Username can only contain letters, numbers, hyphens, and underscores'}), 400
    if not password or len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400
    if not name:
        name = username

    pw_hash = generate_password_hash(password)

    with _db() as conn:
        try:
            cursor = conn.execute(
                "INSERT INTO profiles (username, password_hash, name, color, last_active_at) "
                "VALUES (?, ?, ?, ?, datetime('now'))",
                (username, pw_hash, name, color)
            )
            conn.commit()
            pid = cursor.lastrowid
            session['profile_id'] = pid
            session['profile_name'] = name
            row = conn.execute(
                f"SELECT {_PROFILE_COLS} FROM profiles WHERE id = ?", (pid,)
            ).fetchone()
            return jsonify(dict(row)), 201
        except sqlite3.IntegrityError:
            return jsonify({'error': f'Username "{username}" is already taken'}), 400


@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    if _rate_limited(request.remote_addr):
        return jsonify({'error': 'Too many attempts. Please wait a few minutes.'}), 429

    data = request.get_json() or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400

    with _db() as conn:
        row = conn.execute(
            f"SELECT {_PROFILE_COLS}, password_hash FROM profiles WHERE username = ?",
            (username,)
        ).fetchone()
        if not row:
            return jsonify({'error': 'Invalid username or password'}), 401
        if not row['password_hash'] or not check_password_hash(row['password_hash'], password):
            return jsonify({'error': 'Invalid username or password'}), 401

        user = dict(row)
        del user['password_hash']
        session['profile_id'] = user['id']
        session['profile_name'] = user['name']
        conn.execute(
            "UPDATE profiles SET last_active_at = datetime('now') WHERE id = ?",
            (user['id'],)
        )
        conn.commit()
        return jsonify(user)


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.pop('profile_id', None)
    session.pop('profile_name', None)
    return jsonify({'logged_out': True})


@app.route('/api/auth/change-password', methods=['POST'])
def auth_change_password():
    pid = session.get('profile_id')
    if not pid:
        return jsonify({'error': 'Not logged in'}), 401

    data = request.get_json() or {}
    current_pw = data.get('currentPassword', '')
    new_pw = data.get('newPassword', '')

    if not current_pw or not new_pw:
        return jsonify({'error': 'Current and new password are required'}), 400
    if len(new_pw) < 8:
        return jsonify({'error': 'New password must be at least 8 characters'}), 400

    with _db() as conn:
        row = conn.execute(
            "SELECT password_hash FROM profiles WHERE id = ?", (pid,)
        ).fetchone()
        if not row or not check_password_hash(row['password_hash'], current_pw):
            return jsonify({'error': 'Current password is incorrect'}), 401

        conn.execute(
            "UPDATE profiles SET password_hash = ? WHERE id = ?",
            (generate_password_hash(new_pw), pid)
        )
        conn.commit()
        return jsonify({'success': True})


@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    pid = session.get('profile_id')
    if not pid:
        return jsonify({'id': None, 'name': 'Guest'})
    with _db() as conn:
        row = conn.execute(
            f"SELECT {_PROFILE_COLS} FROM profiles WHERE id = ?", (pid,)
        ).fetchone()
        if not row:
            session.pop('profile_id', None)
            return jsonify({'id': None, 'name': 'Guest'})
        return jsonify(dict(row))


# ── User Settings API ────────────────────────────────

@app.route('/api/users/<int:uid>', methods=['PUT'])
def update_user(uid):
    if session.get('profile_id') != uid:
        return jsonify({'error': 'Unauthorized'}), 403

    data = request.get_json() or {}
    with _db() as conn:
        updates = []
        params = []
        if 'name' in data:
            name = (data['name'] or '').strip()[:20]
            if name:
                updates.append("name = ?")
                params.append(name)
        if 'color' in data and _HEX_COLOR_RE.match(str(data['color'])):
            updates.append("color = ?")
            params.append(data['color'])
        if 'ageBracket' in data:
            updates.append("age_bracket = ?")
            params.append(data['ageBracket'])
        if 'colorblind' in data:
            updates.append("colorblind = ?")
            params.append(1 if data['colorblind'] else 0)

        if updates:
            params.append(uid)
            conn.execute(
                f"UPDATE profiles SET {', '.join(updates)} WHERE id = ?",
                params
            )
            conn.commit()

        row = conn.execute(
            f"SELECT {_PROFILE_COLS} FROM profiles WHERE id = ?", (uid,)
        ).fetchone()
        return jsonify(dict(row))


# ── Brain Game Score API ──────────────────────────────

@app.route('/api/scores', methods=['GET'])
def get_scores():
    """Return score history for the active user. Optional ?game= filter."""
    pid = session.get('profile_id')
    game = request.args.get('game')

    where = []
    params = []
    if pid:
        where.append("profile_id = ?")
        params.append(pid)
    else:
        where.append("profile_id IS NULL")
    if game:
        where.append("game_key = ?")
        params.append(game)

    with _db() as conn:
        rows = conn.execute(
            "SELECT id, game_key, data, display_text, played_at "
            "FROM brain_scores WHERE " + " AND ".join(where) +
            " ORDER BY played_at DESC LIMIT 200",
            params
        ).fetchall()

        results = []
        for r in rows:
            entry = dict(r)
            try:
                entry['data'] = json.loads(entry['data']) if entry['data'] else {}
            except (json.JSONDecodeError, TypeError):
                entry['data'] = {}
            results.append(entry)
        return jsonify(results)


@app.route('/api/scores', methods=['POST'])
def save_score():
    pid = session.get('profile_id')
    data = request.get_json() or {}

    game_key = data.get('game')
    game_data = data.get('data', {})
    display_text = data.get('displayText', '')

    if not game_key:
        return jsonify({'error': 'game is required'}), 400
    if game_key not in VALID_GAME_KEYS:
        return jsonify({'error': 'Invalid game key'}), 400

    with _db() as conn:
        conn.execute(
            "INSERT INTO brain_scores (profile_id, game_key, data, display_text) "
            "VALUES (?, ?, ?, ?)",
            (pid, game_key, json.dumps(game_data), display_text)
        )
        if pid:
            conn.execute(
                "UPDATE profiles SET last_active_at = datetime('now') WHERE id = ?",
                (pid,)
            )
        conn.commit()
        return jsonify({'saved': True}), 201


@app.route('/api/scores/import', methods=['POST'])
def import_scores():
    """Batch import multiple scores in a single request."""
    pid = session.get('profile_id')
    data = request.get_json() or {}
    entries = data.get('entries', [])
    if not isinstance(entries, list):
        return jsonify({'error': 'entries must be an array'}), 400

    imported = 0
    with _db() as conn:
        for entry in entries:
            game_key = entry.get('game')
            if not game_key or game_key not in VALID_GAME_KEYS:
                continue
            game_data = entry.get('data', {})
            display_text = entry.get('displayText', '')
            conn.execute(
                "INSERT INTO brain_scores (profile_id, game_key, data, display_text) "
                "VALUES (?, ?, ?, ?)",
                (pid, game_key, json.dumps(game_data), display_text)
            )
            imported += 1
        if pid and imported > 0:
            conn.execute(
                "UPDATE profiles SET last_active_at = datetime('now') WHERE id = ?",
                (pid,)
            )
        conn.commit()
    return jsonify({'imported': imported}), 201


@app.route('/api/scores/clear', methods=['POST'])
def clear_scores():
    pid = session.get('profile_id')
    with _db() as conn:
        if pid:
            conn.execute("DELETE FROM brain_scores WHERE profile_id = ?", (pid,))
        else:
            conn.execute("DELETE FROM brain_scores WHERE profile_id IS NULL")
        conn.commit()
        return jsonify({'cleared': True})


@app.route('/health')
def health_check():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    app.run(debug=True, host='0.0.0.0', port=port)
