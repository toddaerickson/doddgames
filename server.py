"""Unified DoddGames server.

Serves the DoddGames cognitive assessment platform at /
and mounts Rummy 5000 at /rummy5000.

Provides shared profile and brain-game score APIs so both
apps use server-side storage with a single login.
"""

import os
import json
import sqlite3

from flask import Flask, send_from_directory, jsonify, request, session

from rummy5000.app import rummy_bp, init_db, DB_PATH

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get('SECRET_KEY', 'doddgames-dev-key-change-in-production')

# Initialize database (creates tables if needed)
init_db()

# Migrate existing DB: add columns that may not exist yet
def _migrate_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Check which columns exist on profiles
    cols = {row[1] for row in cursor.execute("PRAGMA table_info(profiles)").fetchall()}
    migrations = [
        ('color', "ALTER TABLE profiles ADD COLUMN color TEXT DEFAULT '#7b2ff7'"),
        ('age_bracket', "ALTER TABLE profiles ADD COLUMN age_bracket TEXT DEFAULT ''"),
        ('colorblind', "ALTER TABLE profiles ADD COLUMN colorblind INTEGER DEFAULT 0"),
        ('last_active_at', "ALTER TABLE profiles ADD COLUMN last_active_at TEXT"),
    ]
    for col, sql in migrations:
        if col not in cols:
            cursor.execute(sql)
    # Create brain_scores table if needed
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
    conn.close()

_migrate_db()

# Mount Rummy 5000 blueprint
app.register_blueprint(rummy_bp, url_prefix='/rummy5000')

# ── DoddGames static file serving ─────────────────────

DODDGAMES_ROOT = os.path.dirname(os.path.abspath(__file__))


@app.route('/')
def doddgames_index():
    return send_from_directory(DODDGAMES_ROOT, 'index.html')


@app.route('/css/<path:path>')
def doddgames_css(path):
    return send_from_directory(os.path.join(DODDGAMES_ROOT, 'css'), path)


@app.route('/js/<path:path>')
def doddgames_js(path):
    return send_from_directory(os.path.join(DODDGAMES_ROOT, 'js'), path)


# ── Shared Profile API ────────────────────────────────
# Used by both DoddGames brain games and Rummy 5000

def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@app.route('/api/users', methods=['GET'])
def list_users():
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, name, color, age_bracket, colorblind, created_at, last_active_at "
            "FROM profiles ORDER BY last_active_at DESC NULLS LAST, name"
        ).fetchall()
        return jsonify([dict(r) for r in rows])


@app.route('/api/users', methods=['POST'])
def create_user():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()[:20]
    color = data.get('color', '#7b2ff7')
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    with _db() as conn:
        try:
            cursor = conn.execute(
                "INSERT INTO profiles (name, color, last_active_at) VALUES (?, ?, datetime('now'))",
                (name, color)
            )
            conn.commit()
            pid = cursor.lastrowid
            # Auto-select the new user
            session['profile_id'] = pid
            session['profile_name'] = name
            row = conn.execute(
                "SELECT id, name, color, age_bracket, colorblind, created_at, last_active_at "
                "FROM profiles WHERE id = ?", (pid,)
            ).fetchone()
            return jsonify(dict(row)), 201
        except sqlite3.IntegrityError:
            return jsonify({'error': f'Name "{name}" already exists'}), 400


@app.route('/api/users/<int:uid>/select', methods=['POST'])
def select_user(uid):
    with _db() as conn:
        row = conn.execute(
            "SELECT id, name, color, age_bracket, colorblind, created_at, last_active_at "
            "FROM profiles WHERE id = ?", (uid,)
        ).fetchone()
        if not row:
            return jsonify({'error': 'User not found'}), 404
        user = dict(row)
        session['profile_id'] = uid
        session['profile_name'] = user['name']
        conn.execute(
            "UPDATE profiles SET last_active_at = datetime('now') WHERE id = ?",
            (uid,)
        )
        conn.commit()
        return jsonify(user)


@app.route('/api/users/<int:uid>', methods=['PUT'])
def update_user(uid):
    data = request.get_json() or {}
    with _db() as conn:
        row = conn.execute("SELECT id FROM profiles WHERE id = ?", (uid,)).fetchone()
        if not row:
            return jsonify({'error': 'User not found'}), 404

        updates = []
        params = []
        if 'name' in data:
            name = (data['name'] or '').strip()[:20]
            if name:
                updates.append("name = ?")
                params.append(name)
        if 'color' in data:
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
            try:
                conn.execute(
                    f"UPDATE profiles SET {', '.join(updates)} WHERE id = ?",
                    params
                )
                conn.commit()
            except sqlite3.IntegrityError:
                return jsonify({'error': 'Name already exists'}), 400

        row = conn.execute(
            "SELECT id, name, color, age_bracket, colorblind, created_at, last_active_at "
            "FROM profiles WHERE id = ?", (uid,)
        ).fetchone()
        return jsonify(dict(row))


@app.route('/api/users/<int:uid>', methods=['DELETE'])
def delete_user(uid):
    with _db() as conn:
        conn.execute("DELETE FROM brain_scores WHERE profile_id = ?", (uid,))
        conn.execute("DELETE FROM profiles WHERE id = ?", (uid,))
        conn.commit()

        # If deleted user was active, clear session
        if session.get('profile_id') == uid:
            session.pop('profile_id', None)
            session.pop('profile_name', None)

        return jsonify({'deleted': True})


@app.route('/api/users/active', methods=['GET'])
def active_user():
    pid = session.get('profile_id')
    if not pid:
        return jsonify({'id': None, 'name': 'Guest'})
    with _db() as conn:
        row = conn.execute(
            "SELECT id, name, color, age_bracket, colorblind, created_at, last_active_at "
            "FROM profiles WHERE id = ?", (pid,)
        ).fetchone()
        if not row:
            session.pop('profile_id', None)
            return jsonify({'id': None, 'name': 'Guest'})
        return jsonify(dict(row))


@app.route('/api/users/guest', methods=['POST'])
def guest_mode():
    session.pop('profile_id', None)
    session.pop('profile_name', None)
    return jsonify({'id': None, 'name': 'Guest'})


# ── Brain Game Score API ──────────────────────────────

@app.route('/api/scores', methods=['GET'])
def get_scores():
    pid = session.get('profile_id')
    game = request.args.get('game')

    with _db() as conn:
        if game:
            if pid:
                rows = conn.execute(
                    "SELECT id, game_key, data, display_text, played_at "
                    "FROM brain_scores WHERE profile_id = ? AND game_key = ? "
                    "ORDER BY played_at DESC LIMIT 200",
                    (pid, game)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, game_key, data, display_text, played_at "
                    "FROM brain_scores WHERE profile_id IS NULL AND game_key = ? "
                    "ORDER BY played_at DESC LIMIT 200",
                    (game,)
                ).fetchall()
        else:
            if pid:
                rows = conn.execute(
                    "SELECT id, game_key, data, display_text, played_at "
                    "FROM brain_scores WHERE profile_id = ? "
                    "ORDER BY played_at DESC LIMIT 200",
                    (pid,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, game_key, data, display_text, played_at "
                    "FROM brain_scores WHERE profile_id IS NULL "
                    "ORDER BY played_at DESC LIMIT 200"
                ).fetchall()

        results = []
        for r in rows:
            entry = dict(r)
            entry['data'] = json.loads(entry['data']) if entry['data'] else {}
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

    with _db() as conn:
        conn.execute(
            "INSERT INTO brain_scores (profile_id, game_key, data, display_text) "
            "VALUES (?, ?, ?, ?)",
            (pid, game_key, json.dumps(game_data), display_text)
        )
        # Update last_active_at on profile
        if pid:
            conn.execute(
                "UPDATE profiles SET last_active_at = datetime('now') WHERE id = ?",
                (pid,)
            )
        conn.commit()
        return jsonify({'saved': True}), 201


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


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    app.run(debug=True, host='0.0.0.0', port=port)
