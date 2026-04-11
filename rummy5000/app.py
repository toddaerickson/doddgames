"""Flask Blueprint for Rummy 5000.

Provides REST API endpoints for game actions, profiles, and history.
Designed to be mounted at /rummy5000 by the unified server.
"""

import os
import time
import uuid
import json
import sqlite3
from flask import Blueprint, jsonify, request, session, render_template

from .game.engine import GameEngine, GameError, Phase
from .game.ai import AIPlayer
from .game.deck import Card
from .models.profile import ProfileModel
from .models.history import HistoryModel

DB_PATH = os.environ.get('DATABASE_PATH',
    os.path.join(os.path.dirname(__file__), 'db', 'rummy5000.db'))

# ── Database init ──────────────────────────────────────

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    schema_path = os.path.join(os.path.dirname(__file__), 'db', 'schema.sql')
    with open(schema_path) as f:
        conn.executescript(f.read())
    conn.close()

profiles = ProfileModel(DB_PATH)
history = HistoryModel(DB_PATH)

# In-memory game state per session (keyed by session ID).
# Entries have a 'last_active' timestamp for cleanup.
MAX_SESSIONS = 100
SESSION_TTL = 3600  # 1 hour
active_games: dict[str, dict] = {}


def _session_id() -> str:
    if 'sid' not in session:
        session['sid'] = str(uuid.uuid4())
    return session['sid']


def _get_game() -> tuple[GameEngine | None, AIPlayer | None]:
    sid = _session_id()
    entry = active_games.get(sid)
    if not entry:
        return None, None
    entry['last_active'] = time.time()
    return entry['engine'], entry['ai']


def _cleanup_sessions():
    """Remove expired sessions to prevent memory leak."""
    now = time.time()
    expired = [sid for sid, entry in active_games.items()
               if now - entry.get('last_active', 0) > SESSION_TTL]
    for sid in expired:
        del active_games[sid]
    # Also enforce max sessions (evict oldest)
    if len(active_games) > MAX_SESSIONS:
        by_age = sorted(active_games.items(), key=lambda x: x[1].get('last_active', 0))
        for sid, _ in by_age[:len(active_games) - MAX_SESSIONS]:
            del active_games[sid]


def _game_response(engine: GameEngine, ai_actions: list = None) -> dict:
    """Build a standard API response with full game state."""
    resp = engine.to_dict()
    if ai_actions:
        resp['ai_actions'] = ai_actions
    return resp


# ── Blueprint ─────────────────────────────────────────

rummy_bp = Blueprint('rummy', __name__,
                     static_folder='static',
                     template_folder='templates',
                     static_url_path='/static')


# ── Frontend ───────────────────────────────────────────

@rummy_bp.route('/')
def index():
    return render_template('index.html')


# ── Profile endpoints ──────────────────────────────────

@rummy_bp.route('/api/profiles', methods=['GET'])
def list_profiles():
    return jsonify(profiles.list_all())


@rummy_bp.route('/api/profiles', methods=['POST'])
def create_profile():
    data = request.get_json()
    name = data.get('name', '').strip() if data else ''
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    if len(name) < 2 or len(name) > 20:
        return jsonify({'error': 'Name must be 2-20 characters'}), 400
    try:
        profile = profiles.create(name)
        return jsonify(profile), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@rummy_bp.route('/api/profiles/<int:pid>/select', methods=['POST'])
def select_profile(pid):
    profile = profiles.get(pid)
    if not profile:
        return jsonify({'error': 'Profile not found'}), 404
    session['profile_id'] = pid
    session['profile_name'] = profile['name']
    return jsonify(profile)


@rummy_bp.route('/api/profiles/guest', methods=['POST'])
def guest_profile():
    session.pop('profile_id', None)
    session['profile_name'] = 'Guest'
    return jsonify({'name': 'Guest', 'id': None})


@rummy_bp.route('/api/profiles/active', methods=['GET'])
def active_profile():
    pid = session.get('profile_id')
    name = session.get('profile_name', 'Guest')
    return jsonify({'id': pid, 'name': name})


# ── Game endpoints ─────────────────────────────────────

@rummy_bp.route('/api/game/new', methods=['POST'])
def new_game():
    _cleanup_sessions()

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
        'last_active': time.time(),
    }

    return jsonify(_game_response(engine))


@rummy_bp.route('/api/game/state', methods=['GET'])
def game_state():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404
    return jsonify(_game_response(engine))


@rummy_bp.route('/api/game/draw', methods=['POST'])
def draw_card():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404
    try:
        engine.player_draw_from_pile()
        return jsonify(_game_response(engine))
    except GameError as e:
        # If draw pile exhausted, return the round-end state
        if engine.phase in (Phase.ROUND_END, Phase.GAME_OVER):
            _save_round_data()
            return jsonify(_game_response(engine))
        return jsonify({'error': str(e)}), 400


@rummy_bp.route('/api/game/pickup', methods=['POST'])
def pickup_discard():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404

    data = request.get_json() or {}
    card_index = data.get('card_index')
    if card_index is None or not isinstance(card_index, int):
        return jsonify({'error': 'card_index (integer) is required'}), 400

    try:
        engine.player_pickup_from_discard(card_index)
        return jsonify(_game_response(engine))
    except GameError as e:
        return jsonify({'error': str(e)}), 400


@rummy_bp.route('/api/game/meld', methods=['POST'])
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
        if engine.phase in (Phase.ROUND_END, Phase.GAME_OVER):
            _save_round_data()
        return jsonify(resp)
    except GameError as e:
        return jsonify({'error': str(e)}), 400


@rummy_bp.route('/api/game/layoff', methods=['POST'])
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
            _save_round_data()
        return jsonify(resp)
    except GameError as e:
        return jsonify({'error': str(e)}), 400


@rummy_bp.route('/api/game/discard', methods=['POST'])
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
            _save_round_data()
            return jsonify(_game_response(engine))

        # AI turn
        ai_actions = []
        if engine.phase == Phase.AI_TURN:
            ai_actions = ai.take_turn(engine)

            if engine.phase in (Phase.ROUND_END, Phase.GAME_OVER):
                _save_round_data()

        return jsonify(_game_response(engine, ai_actions))
    except GameError as e:
        return jsonify({'error': str(e)}), 400


@rummy_bp.route('/api/game/sort', methods=['POST'])
def sort_hand():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404

    data = request.get_json() or {}
    by = data.get('by', 'rank')
    engine.player_sort_hand(by)
    return jsonify(_game_response(engine))


@rummy_bp.route('/api/game/hint', methods=['GET'])
def get_hint():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404
    return jsonify(engine.get_hint())


@rummy_bp.route('/api/game/next-round', methods=['POST'])
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


@rummy_bp.route('/api/game/save', methods=['POST'])
def save_game():
    engine, _ = _get_game()
    if not engine:
        return jsonify({'error': 'No active game'}), 404

    sid = _session_id()
    entry = active_games.get(sid)
    if not entry:
        return jsonify({'error': 'No active game'}), 404

    db_id = entry['db_id']
    state_json = engine.to_json()
    history.save_game_state(db_id, state_json)
    history.update_game(db_id, engine.player.total_score, engine.ai.total_score,
                        engine.round_number, 'in_progress', state_json)
    return jsonify({'saved': True})


@rummy_bp.route('/api/game/resume', methods=['POST'])
def resume_game():
    """Resume a previously saved game."""
    profile_id = session.get('profile_id')
    saved = history.get_saved_game(profile_id)
    if not saved or not saved.get('saved_state'):
        return jsonify({'error': 'No saved game found'}), 404

    try:
        state = json.loads(saved['saved_state'])
        engine = _restore_engine(state)
        ai = AIPlayer(difficulty=engine.difficulty)

        sid = _session_id()
        active_games[sid] = {
            'engine': engine,
            'ai': ai,
            'db_id': saved['id'],
            'last_active': time.time(),
        }
        return jsonify(_game_response(engine))
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        return jsonify({'error': 'Saved game is corrupted'}), 400


@rummy_bp.route('/api/game/has-save', methods=['GET'])
def has_saved_game():
    """Check if a saved game exists for the active profile."""
    profile_id = session.get('profile_id')
    saved = history.get_saved_game(profile_id)
    has_save = saved is not None and saved.get('saved_state') is not None
    return jsonify({'has_save': has_save})


# ── History & Stats endpoints ──────────────────────────

@rummy_bp.route('/api/history', methods=['GET'])
def get_history():
    pid = session.get('profile_id')
    if not pid:
        return jsonify([])
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)
    return jsonify(history.get_history(pid, limit, offset))


@rummy_bp.route('/api/history/<int:game_id>/rounds', methods=['GET'])
def get_game_rounds(game_id):
    return jsonify(history.get_game_rounds(game_id))


@rummy_bp.route('/api/stats', methods=['GET'])
def get_stats():
    pid = session.get('profile_id')
    if not pid:
        return jsonify({'error': 'Select a profile to view stats'}), 400
    return jsonify(history.get_stats(pid))


# ── Helpers ────────────────────────────────────────────

def _save_round_data():
    """Save the latest round to the database."""
    sid = _session_id()
    entry = active_games.get(sid)
    if not entry:
        return

    engine = entry['engine']
    db_id = entry['db_id']
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


def _restore_engine(state: dict) -> GameEngine:
    """Reconstruct a GameEngine from saved JSON state."""
    engine = GameEngine(
        difficulty=state['difficulty'],
        target_score=state['target_score']
    )
    engine.round_number = state['round_number']
    engine.phase = Phase(state['phase'])
    engine.round_history = state.get('round_history', [])
    engine._game_over = state.get('game_over', False)

    # Restore cards
    def _card_from_dict(d):
        return Card(rank=d['rank'], suit=d['suit'], is_joker=d.get('is_joker', False))

    engine.player.hand = [_card_from_dict(c) for c in state['player']['hand']]
    engine.player.melds = [[_card_from_dict(c) for c in m] for m in state['player']['melds']]
    engine.player.total_score = state['player']['total_score']
    engine.player.round_score = state['player']['round_score']

    engine.ai.hand = [_card_from_dict(c) for c in state['ai']['hand']]
    engine.ai.melds = [[_card_from_dict(c) for c in m] for m in state['ai']['melds']]
    engine.ai.total_score = state['ai']['total_score']
    engine.ai.round_score = state['ai']['round_score']

    engine.discard_pile = [_card_from_dict(c) for c in state['discard_pile']]
    engine.deck.cards = [_card_from_dict(c) for c in state.get('deck_cards', [])]

    drawn_id = state.get('_drawn_from_discard')
    if drawn_id:
        engine._drawn_from_discard = next((c for c in engine.player.hand if c.id == drawn_id), None)

    meld_id = state.get('_must_meld_card')
    if meld_id:
        engine._must_meld_card = next((c for c in engine.player.hand if c.id == meld_id), None)

    return engine
