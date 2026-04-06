"""Flask application for Rummy 5000.

Serves the SPA frontend and provides REST API endpoints for
game actions, profiles, and history.
"""

import os
import sqlite3
from flask import Flask, jsonify, request, session, render_template

from game.engine import GameEngine, GameError, Phase
from game.ai import AIPlayer
from models.profile import ProfileModel
from models.history import HistoryModel

app = Flask(__name__,
            static_folder='static',
            template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', 'rummy5000-dev-key-change-in-production')

DB_PATH = os.path.join(os.path.dirname(__file__), 'db', 'rummy5000.db')

# ── Database init ──────────────────────────────────────

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    schema_path = os.path.join(os.path.dirname(__file__), 'db', 'schema.sql')
    with open(schema_path) as f:
        conn.executescript(f.read())
    conn.close()

init_db()

profiles = ProfileModel(DB_PATH)
history = HistoryModel(DB_PATH)

# In-memory game state per session (keyed by session ID)
# In production this would use a proper cache; fine for single-server use.
active_games: dict[str, dict] = {}


def _session_id() -> str:
    if 'sid' not in session:
        import uuid
        session['sid'] = str(uuid.uuid4())
    return session['sid']


def _get_game() -> tuple[GameEngine, AIPlayer]:
    sid = _session_id()
    if sid not in active_games:
        return None, None
    return active_games[sid]['engine'], active_games[sid]['ai']


def _game_response(engine: GameEngine, ai_actions: list = None) -> dict:
    """Build a standard API response with full game state."""
    resp = engine.to_dict()
    if ai_actions:
        resp['ai_actions'] = ai_actions
    return resp


# ── Frontend ───────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


# ── Profile endpoints ──────────────────────────────────

@app.route('/api/profiles', methods=['GET'])
def list_profiles():
    return jsonify(profiles.list_all())


@app.route('/api/profiles', methods=['POST'])
def create_profile():
    data = request.get_json()
    name = data.get('name', '').strip() if data else ''
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    try:
        profile = profiles.create(name)
        return jsonify(profile), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/profiles/<int:pid>/select', methods=['POST'])
def select_profile(pid):
    profile = profiles.get(pid)
    if not profile:
        return jsonify({'error': 'Profile not found'}), 404
    session['profile_id'] = pid
    session['profile_name'] = profile['name']
    return jsonify(profile)


@app.route('/api/profiles/guest', methods=['POST'])
def guest_profile():
    session.pop('profile_id', None)
    session['profile_name'] = 'Guest'
    return jsonify({'name': 'Guest', 'id': None})


@app.route('/api/profiles/active', methods=['GET'])
def active_profile():
    pid = session.get('profile_id')
    name = session.get('profile_name', 'Guest')
    return jsonify({'id': pid, 'name': name})


# ── Game endpoints ─────────────────────────────────────

@app.route('/api/game/new', methods=['POST'])
def new_game():
    data = request.get_json() or {}
    difficulty = data.get('difficulty', 'medium')
    target_score = data.get('target_score', 5000)

    if difficulty not in ('easy', 'medium', 'hard'):
        return jsonify({'error': 'Invalid difficulty'}), 400
    if target_score not in (2500, 5000, 10000):
        return jsonify({'error': 'Invalid target score'}), 400

    engine = GameEngine(difficulty=difficulty, target_score=target_score)
    ai = AIPlayer(difficulty=difficulty)
    engine.new_round()

    sid = _session_id()
    profile_id = session.get('profile_id')
    game_db_id = history.create_game(profile_id, difficulty, target_score)

    active_games[sid] = {
        'engine': engine,
        'ai': ai,
        'db_id': game_db_id,
    }

    return jsonify(_game_response(engine))


@app.route('/api/game/state', methods=['GET'])
def game_state():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404
    return jsonify(_game_response(engine))


@app.route('/api/game/draw', methods=['POST'])
def draw_card():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404
    try:
        card = engine.player_draw_from_pile()
        return jsonify(_game_response(engine))
    except GameError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/game/pickup', methods=['POST'])
def pickup_discard():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404

    data = request.get_json() or {}
    card_index = data.get('card_index')
    if card_index is None:
        return jsonify({'error': 'card_index is required'}), 400

    try:
        engine.player_pickup_from_discard(card_index)
        return jsonify(_game_response(engine))
    except GameError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/game/meld', methods=['POST'])
def meld_cards():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404

    data = request.get_json() or {}
    card_ids = data.get('card_ids', [])
    if len(card_ids) < 3:
        return jsonify({'error': 'A meld requires at least 3 cards'}), 400

    try:
        engine.player_meld(card_ids)
        resp = _game_response(engine)
        # If round ended after meld, save round
        if engine.phase in (Phase.ROUND_END, Phase.GAME_OVER):
            _save_round_data(engine)
        return jsonify(resp)
    except GameError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/game/layoff', methods=['POST'])
def layoff_card():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404

    data = request.get_json() or {}
    card_id = data.get('card_id')
    meld_index = data.get('meld_index')
    if card_id is None or meld_index is None:
        return jsonify({'error': 'card_id and meld_index are required'}), 400

    try:
        engine.player_layoff(card_id, meld_index)
        resp = _game_response(engine)
        if engine.phase in (Phase.ROUND_END, Phase.GAME_OVER):
            _save_round_data(engine)
        return jsonify(resp)
    except GameError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/game/discard', methods=['POST'])
def discard_card():
    engine, ai = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404

    data = request.get_json() or {}
    card_id = data.get('card_id')
    if not card_id:
        return jsonify({'error': 'card_id is required'}), 400

    try:
        engine.player_discard(card_id)

        # If round ended, save and return
        if engine.phase in (Phase.ROUND_END, Phase.GAME_OVER):
            _save_round_data(engine)
            return jsonify(_game_response(engine))

        # AI turn
        ai_actions = []
        if engine.phase == Phase.AI_TURN:
            ai_actions = ai.take_turn(engine)

            # If round ended after AI turn, save
            if engine.phase in (Phase.ROUND_END, Phase.GAME_OVER):
                _save_round_data(engine)

        return jsonify(_game_response(engine, ai_actions))
    except GameError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/game/sort', methods=['POST'])
def sort_hand():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404

    data = request.get_json() or {}
    by = data.get('by', 'rank')
    engine.player_sort_hand(by)
    return jsonify(_game_response(engine))


@app.route('/api/game/hint', methods=['GET'])
def get_hint():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404
    return jsonify(engine.get_hint())


@app.route('/api/game/next-round', methods=['POST'])
def next_round():
    engine, ai = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404

    if engine.phase == Phase.GAME_OVER:
        return jsonify({'error': 'Game is over'}), 400

    if engine.phase != Phase.ROUND_END:
        return jsonify({'error': 'Round is not over yet'}), 400

    ai.reset_round()
    engine.new_round()
    return jsonify(_game_response(engine))


@app.route('/api/game/save', methods=['POST'])
def save_game():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404

    sid = _session_id()
    db_id = active_games[sid]['db_id']
    state_json = engine.to_json()
    history.save_game_state(db_id, state_json)
    history.update_game(db_id, engine.player.total_score, engine.ai.total_score,
                        engine.round_number, 'in_progress', state_json)
    return jsonify({'saved': True})


# ── History & Stats endpoints ──────────────────────────

@app.route('/api/history', methods=['GET'])
def get_history():
    pid = session.get('profile_id')
    if not pid:
        return jsonify([])
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)
    return jsonify(history.get_history(pid, limit, offset))


@app.route('/api/history/<int:game_id>/rounds', methods=['GET'])
def get_game_rounds(game_id):
    return jsonify(history.get_game_rounds(game_id))


@app.route('/api/stats', methods=['GET'])
def get_stats():
    pid = session.get('profile_id')
    if not pid:
        return jsonify({'error': 'Select a profile to view stats'}), 400
    return jsonify(history.get_stats(pid))


# ── Helpers ────────────────────────────────────────────

def _save_round_data(engine: GameEngine):
    """Save the latest round to the database."""
    sid = _session_id()
    if sid not in active_games:
        return

    db_id = active_games[sid]['db_id']
    if engine.round_history:
        latest = engine.round_history[-1]
        history.save_round(db_id, latest)

    result = 'in_progress'
    if engine.phase == Phase.GAME_OVER:
        result = 'win' if engine.get_winner() == 'player' else 'loss'

    history.update_game(
        db_id, engine.player.total_score, engine.ai.total_score,
        engine.round_number, result
    )


if __name__ == '__main__':
    app.run(debug=True, port=5000)
