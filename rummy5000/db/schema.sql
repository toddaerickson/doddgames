-- Rummy 5000 database schema

CREATE TABLE IF NOT EXISTS profiles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT DEFAULT '#7b2ff7',
    age_bracket TEXT DEFAULT '',
    colorblind  INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS games (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id    INTEGER REFERENCES profiles(id),
    difficulty    TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    target_score  INTEGER NOT NULL DEFAULT 5000,
    player_score  INTEGER NOT NULL DEFAULT 0,
    ai_score      INTEGER NOT NULL DEFAULT 0,
    rounds_played INTEGER NOT NULL DEFAULT 0,
    result        TEXT CHECK (result IN ('win', 'loss', 'in_progress')),
    started_at    TEXT DEFAULT (datetime('now')),
    finished_at   TEXT,
    saved_state   TEXT
);

CREATE TABLE IF NOT EXISTS rounds (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id         INTEGER NOT NULL REFERENCES games(id),
    round_number    INTEGER NOT NULL,
    player_meld_pts INTEGER NOT NULL DEFAULT 0,
    player_hand_pts INTEGER NOT NULL DEFAULT 0,
    player_net      INTEGER NOT NULL DEFAULT 0,
    ai_meld_pts     INTEGER NOT NULL DEFAULT 0,
    ai_hand_pts     INTEGER NOT NULL DEFAULT 0,
    ai_net          INTEGER NOT NULL DEFAULT 0,
    went_out        TEXT CHECK (went_out IN ('player', 'ai', 'draw_exhausted'))
);

-- Brain game score history
CREATE TABLE IF NOT EXISTS brain_scores (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id   INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
    game_key     TEXT NOT NULL,
    data         TEXT NOT NULL,
    display_text TEXT,
    played_at    TEXT DEFAULT (datetime('now'))
);
