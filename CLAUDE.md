# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
DoddGames is a unified Flask game platform combining 12 neuropsychological brain games (cognitive assessments), Reversi (AI-powered with 10 difficulty levels), and Rummy 5000 (card game with server-side AI). Single username+password authentication persists across all games. SQLite backend for profiles and game history.

## Development Commands
```bash
# Install and run locally
pip install -r rummy5000/requirements.txt   # Flask + gunicorn
python server.py              # Runs on http://localhost:3000 (override with PORT)

# Run Rummy 5000 tests (92 tests: engine, melds, scoring)
python -m pytest rummy5000/tests/ -v

# Run a single test file or a single test
python -m pytest rummy5000/tests/test_engine.py -v
python -m pytest rummy5000/tests/test_engine.py::test_name -v

# Smoke test locally
curl http://localhost:3000/health
```

No linter/formatter is configured. CI (`.github/workflows/ci.yml`) runs only the Rummy 5000 pytest suite. Note: CI's `push` trigger targets `master`, but the default branch is `main` — only `pull_request` events currently exercise CI.

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

### Shared SQLite database
DoddGames and Rummy 5000 share one SQLite file (`DB_PATH` / `DATABASE_PATH` from `rummy5000/app.py`, default `rummy5000/db/rummy5000.db`). `rummy5000/db/schema.sql` creates the base tables (`profiles`, history) on init; `server.py:_migrate_db()` then runs idempotent `ALTER TABLE`s to add auth/profile columns (`username`, `password_hash`, `color`, etc.) and creates the `brain_scores` table for brain-game and Reversi results. Both migration paths are safe to run repeatedly.

### Brain-game score allowlist
`server.py:VALID_GAME_KEYS` is the allowlist enforced by `POST /api/scores` and `/api/scores/import`. Adding a new brain game (or any score-saving game) requires adding its key here, or score saves return HTTP 400.

### Authentication
Sessions persist 365 days (permanent Flask cookie). Passwords hashed with werkzeug. Rate limiting on `/api/auth/register` and `/api/auth/login` (10 attempts per 5 min per IP). SECRET_KEY required in production (a default dev key is used otherwise, with a warning).

## Deploy (Railway)
Dockerfile: Python 3.12-slim → gunicorn with 1 worker, 120s timeout.

Environment variables required:
- `SECRET_KEY` — Flask session cookie key (random hex string)
- `DATABASE_PATH` — Persistent SQLite path (e.g., `/data/doddgames.db`)

Persistent volume mount at `/data` in Railway service settings. Health check: `GET /health` every 10s.
