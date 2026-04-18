# DoddGames

A unified game platform combining cognitive assessment brain games with strategy games, served from a single Flask application with username + password authentication that works across devices.

## What's Inside

### Brain Games (12 neuropsychological assessments)

Organized into four cognitive domains, each game runs as a 5-minute timed session:

| Domain | Games |
|--------|-------|
| **Processing Speed** | Schulte Table, Trail Making A, Symbol-Digit |
| **Executive Function** | Tetris, Trail Making B, Card Sort, Tower of London |
| **Inhibitory Control** | Stroop Test, Go/No-Go, CPT |
| **Memory** | Word List Learning, Digit Span |

Includes a **Cognitive Profile** dashboard with radar charts, within-user z-scores, pattern matching against reference profiles, and retest tracking.

### Strategy Games

**Reversi (Othello)** — Classic board game against AI with **10 difficulty levels** from Beginner to Mastery. AI uses minimax with alpha-beta pruning and a positional + mobility heuristic.

- Undo, play as black or white
- **Teaching hints** — explain *why* a suggested move is good, including positional value (corner/edge/X-square), defensive considerations (blocks opponent corners), and a 2-3 move lookahead
- Win/loss/draw records saved to your score history

**Rummy 5000** — Card game against AI opponents with three difficulty levels (Easy, Medium, Hard). Features include game save/resume, score history, and per-player statistics.

## Authentication

Users register with a **username + password** (hashed with werkzeug) and can log in from any browser or device.

- Sessions persist 365 days via a permanent Flask session cookie
- A single login carries across brain games, Reversi, and Rummy 5000
- Rummy 5000's profile picker is skipped automatically for logged-in users
- Change password available from the user dropdown
- "Continue as Guest" supported for users who don't want an account

## PWA Support

Installable on mobile via `manifest.json` — "Add to Home Screen" on iOS/Android gives an app-like standalone experience with a custom icon.

## Architecture

```
server.py (Flask)
  |-- /                    DoddGames landing page + brain games (static SPA)
  |-- /api/auth/           Register, login, logout, me, change-password
  |-- /api/users/<id>      Update profile settings (name, color, age, etc.)
  |-- /api/scores/         Brain game + Reversi score storage
  |-- /reversi/            Reversi game (client-side, 10 AI levels)
  |-- /rummy5000/          Rummy 5000 SPA (Flask Blueprint)
  |-- /rummy5000/api/      Rummy 5000 game engine API
  |-- /manifest.json       PWA manifest
  |-- /icon-192.png, /icon-512.png  PWA icons
```

- **Server-side storage** — all user profiles and scores stored in SQLite (`DATABASE_PATH` env var, defaults to `rummy5000/db/rummy5000.db`)
- **Brain games** are a pure client-side SPA (HTML/CSS/JS) served as static files
- **Reversi** is fully client-side; AI runs in the browser
- **Rummy 5000** is a full-stack Blueprint with server-side game state and AI

## Project Structure

```
doddgames/
  server.py               Unified Flask server (entry point)
  Dockerfile              Production container (gunicorn)
  railway.toml            Railway deployment config
  manifest.json           PWA manifest
  icon-192.png, icon-512.png  PWA icons
  index.html              DoddGames landing page (login + game cards)
  css/styles.css          DoddGames styles
  js/
    app.js                Main controller (navigation, timer, auth)
    users.js              Auth client (talks to /api/auth)
    scores.js             Score manager (talks to /api/scores)
    profile.js            Cognitive profile dashboard
    audio.js              Sound effects
    games/                12 brain game modules
  reversi/
    index.html              Reversi game page
    styles.css              Reversi styles
    app.js                  Game engine, AI (minimax), teaching hints
  rummy5000/
    app.py                Flask Blueprint with game API endpoints
    game/                 Game engine, AI, deck, melds, scoring
    models/               SQLite models for game history
    db/schema.sql         Database schema
    static/               Rummy 5000 frontend (CSS + JS)
    templates/            Rummy 5000 HTML template
```

## Local Development

```bash
pip install flask
python server.py
```

Open http://localhost:3000 for brain games, http://localhost:3000/reversi/ for Reversi, or http://localhost:3000/rummy5000 for Rummy 5000.

## Deployment

The `Dockerfile` builds a production image using gunicorn. Deployed on [Railway](https://railway.app) via `railway.toml`.

### Required environment variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `SECRET_KEY` | Secures Flask session cookies | A random string — `python -c "import secrets; print(secrets.token_hex(32))"` |
| `DATABASE_PATH` | Path to SQLite DB file (for persistence) | `/data/doddgames.db` |

### Persistent storage on Railway

Railway containers have ephemeral filesystems — to keep users and scores across deploys:

1. Service Settings → Volumes → Add Volume → mount path `/data`
2. Set `DATABASE_PATH=/data/doddgames.db`

## API Overview

### Authentication (`/api/auth`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account `{username, password, name, color}` |
| POST | `/api/auth/login` | Log in `{username, password}` |
| POST | `/api/auth/logout` | Clear session |
| POST | `/api/auth/change-password` | Update password `{currentPassword, newPassword}` |
| GET  | `/api/auth/me` | Get current user (or Guest) |

### User Settings (`/api/users`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/api/users/<id>` | Update display name, color, age bracket, colorblind mode |

### Scores (`/api/scores`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/scores` | Get score history (optional `?game=` filter) |
| POST | `/api/scores` | Save a score `{game, data, displayText}` |
| POST | `/api/scores/clear` | Clear all scores for active user |

### Rummy 5000 (`/rummy5000/api`)

Game actions: `/api/game/new`, `/api/game/draw`, `/api/game/pickup`, `/api/game/meld`, `/api/game/layoff`, `/api/game/discard`, `/api/game/sort`, `/api/game/hint`, `/api/game/save`, `/api/game/resume`, `/api/game/next-round`

History and stats: `/api/history`, `/api/stats`
