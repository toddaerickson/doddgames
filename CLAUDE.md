# CLAUDE.md — Project Intelligence

## Project Overview
DoddGames is a unified Flask game platform combining 12 neuropsychological brain games (cognitive assessments), Reversi (AI-powered with 10 difficulty levels), and Rummy 5000 (card game with server-side AI). Single username+password authentication persists across all games. SQLite backend for profiles and game history.

## Development Commands
```bash
# Install and run locally
pip install flask gunicorn
python server.py              # Runs on http://localhost:5000

# Run Rummy 5000 tests (engine, melds, scoring)
python -m pytest rummy5000/tests/ -v

# Smoke test locally
curl http://localhost:5000/health
```

## Architecture

### Top-level routes
- `server.py` — unified Flask entry point with shared auth, rate limiting, session management
- `/` — DoddGames landing page (static SPA: index.html + js/games/*.js)
- `/reversi/` — Reversi game (fully client-side, browser-run minimax AI)
- `/rummy5000/` — Rummy 5000 (Flask Blueprint with server-side game engine)

### Rummy 5000 structure
- `rummy5000/app.py` — Blueprint, in-memory game sessions, REST API endpoints
- `rummy5000/game/engine.py` — GameEngine state machine (DEALING → PLAYER_DRAW → PLAYER_MELD_OR_DISCARD → AI_TURN → ROUND_END → GAME_OVER)
- `rummy5000/game/{deck,melds,scoring,ai}.py` — Deck, validation, scoring rules, AI strategy
- `rummy5000/models/{profile,history}.py` — SQLite queries
- `rummy5000/tests/{test_engine,test_melds,test_scoring}.py` — 92 pytest tests

### Static files
- `css/` & `js/` — DoddGames brain games (Schulte, Tetris, Stroop, Trails, etc.)
- `rummy5000/static/` — Rummy 5000 frontend (cards.css, cards.js)
- `reversi/` — Reversi board game

## Key Conventions & Pitfalls

### Game engine state machine
GameEngine is the single source of truth. All player + AI actions validated here first. Phase enum drives turn flow.

### In-memory session cleanup
`rummy5000/app.py:active_games` stores engines per session (keyed by UUID). Cleanup runs every 5 minutes; max 100 concurrent sessions with 1-hour TTL. Missing cleanup = memory leak on long-lived deployments.

### Database migrations
`server.py:_migrate_db()` runs ALTER TABLE on startup for DoddGames profiles. Safe to run repeatedly. Rummy 5000 uses fresh `schema.sql` on init.

### Authentication
Sessions persist 365 days (permanent Flask cookie). Passwords hashed with werkzeug. Rate limiting on `/api/auth/*` (10 attempts per 5 min per IP). SECRET_KEY required in production.

## Deploy (Railway)
Dockerfile: Python 3.12-slim → gunicorn with 1 worker, 120s timeout.

Environment variables required:
- `SECRET_KEY` — Flask session cookie key (random hex string)
- `DATABASE_PATH` — Persistent SQLite path (e.g., `/data/doddgames.db`)

Persistent volume mount at `/data` in Railway service settings. Health check: `GET /health` every 10s.
