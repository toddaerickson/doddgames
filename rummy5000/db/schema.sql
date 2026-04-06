-- Rummy 5000 database schema

CREATE TABLE IF NOT EXISTS profiles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT DEFAULT (datetime('now'))
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
