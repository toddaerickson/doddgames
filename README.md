# DoddGames

A unified game platform combining cognitive assessment brain games with strategy games, served from a single Flask application with shared user profiles.

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

**Reversi (Othello)** — Classic board game against AI with 10 difficulty levels from Beginner to Mastery. AI uses minimax with alpha-beta pruning and a positional + mobility heuristic. Features include undo, hints, and choice of playing as black or white.

**Rummy 5000** — Card game against AI opponents with three difficulty levels (Easy, Medium, Hard). Features include game save/resume, score history, and per-player statistics.

## Architecture

```
server.py (Flask)
  |-- /                    DoddGames landing page + brain games (static SPA)
  |-- /api/users/          Shared user profile management
  |-- /api/scores/         Brain game score storage
  |-- /reversi/            Reversi game (client-side, 10 AI levels)
  |-- /rummy5000/          Rummy 5000 SPA (Flask Blueprint)
  |-- /rummy5000/api/      Rummy 5000 game engine API
```

- **Single login** -- create a profile once, it carries across brain games and Rummy 5000 via Flask session
- **Server-side storage** -- all user profiles and scores stored in SQLite (`rummy5000/db/rummy5000.db`)
- **Brain games** are a pure client-side SPA (HTML/CSS/JS) served as static files
- **Rummy 5000** is a full-stack app with a Flask backend managing game state and an AI opponent

## Project Structure

```
doddgames/
  server.py               Unified Flask server (entry point)
  Dockerfile              Production container (gunicorn)
  railway.toml            Railway deployment config
  index.html              DoddGames landing page
  css/styles.css          DoddGames styles
  js/
    app.js                Main app controller (navigation, timer, user management)
    users.js              User profile manager (talks to /api/users)
    scores.js             Score manager (talks to /api/scores)
    profile.js            Cognitive profile dashboard (z-scores, radar chart)
    audio.js              Sound effects
    games/                12 game modules (one file each)
  reversi/
    index.html              Reversi game page
    styles.css              Reversi styles
    app.js                  Game engine, AI (minimax), and UI controller
  rummy5000/
    app.py                Flask Blueprint with game API endpoints
    game/                 Game engine, AI, deck, melds, scoring
    models/               SQLite models for profiles and game history
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

The `Dockerfile` builds a production image using gunicorn:

```bash
docker build -t doddgames .
docker run -p 3000:3000 -e PORT=3000 doddgames
```

Deployed on [Railway](https://railway.app) via the `railway.toml` config.

Set the `SECRET_KEY` environment variable in production for secure session handling.

## API Overview

### User Profiles (`/api/users`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all profiles |
| POST | `/api/users` | Create profile `{name, color}` |
| POST | `/api/users/<id>/select` | Set active user |
| PUT | `/api/users/<id>` | Update settings |
| DELETE | `/api/users/<id>` | Delete profile and scores |
| GET | `/api/users/active` | Get active profile |
| POST | `/api/users/guest` | Enter guest mode |

### Brain Game Scores (`/api/scores`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/scores` | Get score history (optional `?game=` filter) |
| POST | `/api/scores` | Save a score `{game, data, displayText}` |
| POST | `/api/scores/clear` | Clear all scores for active user |

### Rummy 5000 (`/rummy5000/api`)

Game actions: `/api/game/new`, `/api/game/draw`, `/api/game/pickup`, `/api/game/meld`, `/api/game/layoff`, `/api/game/discard`, `/api/game/sort`, `/api/game/hint`, `/api/game/save`, `/api/game/resume`, `/api/game/next-round`

History and stats: `/api/history`, `/api/stats`
