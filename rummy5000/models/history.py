"""Game history and statistics model (SQLite)."""

import sqlite3


class HistoryModel:
    def __init__(self, db_path: str):
        self.db_path = db_path

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    # ── Game CRUD ──────────────────────────────────────

    def create_game(self, profile_id: int | None, difficulty: str,
                    target_score: int) -> int:
        with self._conn() as conn:
            cursor = conn.execute(
                """INSERT INTO games (profile_id, difficulty, target_score, result)
                   VALUES (?, ?, ?, 'in_progress')""",
                (profile_id, difficulty, target_score)
            )
            conn.commit()
            return cursor.lastrowid

    def update_game(self, game_id: int, player_score: int, ai_score: int,
                    rounds_played: int, result: str,
                    saved_state: str | None = None):
        with self._conn() as conn:
            if result != 'in_progress':
                conn.execute(
                    """UPDATE games SET player_score = ?, ai_score = ?,
                        rounds_played = ?, result = ?, saved_state = ?,
                        finished_at = datetime('now')
                        WHERE id = ?""",
                    (player_score, ai_score, rounds_played, result,
                     saved_state, game_id)
                )
            else:
                conn.execute(
                    """UPDATE games SET player_score = ?, ai_score = ?,
                        rounds_played = ?, result = ?, saved_state = ?
                        WHERE id = ?""",
                    (player_score, ai_score, rounds_played, result,
                     saved_state, game_id)
                )
            conn.commit()

    def save_game_state(self, game_id: int, state_json: str):
        with self._conn() as conn:
            conn.execute(
                "UPDATE games SET saved_state = ? WHERE id = ?",
                (state_json, game_id)
            )
            conn.commit()

    def get_saved_game(self, profile_id: int | None) -> dict | None:
        with self._conn() as conn:
            if profile_id:
                row = conn.execute(
                    """SELECT * FROM games WHERE profile_id = ?
                       AND result = 'in_progress' ORDER BY started_at DESC LIMIT 1""",
                    (profile_id,)
                ).fetchone()
            else:
                row = conn.execute(
                    """SELECT * FROM games WHERE profile_id IS NULL
                       AND result = 'in_progress' ORDER BY started_at DESC LIMIT 1"""
                ).fetchone()
            return dict(row) if row else None

    # ── Round history ──────────────────────────────────

    def save_round(self, game_id: int, round_data: dict):
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO rounds
                   (game_id, round_number, player_meld_pts, player_hand_pts,
                    player_net, ai_meld_pts, ai_hand_pts, ai_net, went_out)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (game_id, round_data['round'],
                 round_data['player']['meld_points'],
                 round_data['player']['hand_penalty'],
                 round_data['player']['net'],
                 round_data['ai']['meld_points'],
                 round_data['ai']['hand_penalty'],
                 round_data['ai']['net'],
                 round_data['went_out'])
            )
            conn.commit()

    # ── History queries ────────────────────────────────

    def get_history(self, profile_id: int, limit: int = 50,
                    offset: int = 0) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT g.*, COUNT(r.id) as round_count
                   FROM games g LEFT JOIN rounds r ON r.game_id = g.id
                   WHERE g.profile_id = ? AND g.result != 'in_progress'
                   GROUP BY g.id ORDER BY g.started_at DESC
                   LIMIT ? OFFSET ?""",
                (profile_id, limit, offset)
            ).fetchall()
            return [dict(r) for r in rows]

    def get_game_rounds(self, game_id: int) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM rounds WHERE game_id = ?
                   ORDER BY round_number""",
                (game_id,)
            ).fetchall()
            return [dict(r) for r in rows]

    # ── Statistics ─────────────────────────────────────

    def get_stats(self, profile_id: int) -> dict:
        with self._conn() as conn:
            # Basic counts
            total = conn.execute(
                "SELECT COUNT(*) as c FROM games WHERE profile_id = ? AND result != 'in_progress'",
                (profile_id,)
            ).fetchone()['c']

            wins = conn.execute(
                "SELECT COUNT(*) as c FROM games WHERE profile_id = ? AND result = 'win'",
                (profile_id,)
            ).fetchone()['c']

            losses = total - wins

            # Best scores
            best_game = conn.execute(
                """SELECT MAX(player_score) as v FROM games
                   WHERE profile_id = ? AND result != 'in_progress'""",
                (profile_id,)
            ).fetchone()['v']

            best_round = conn.execute(
                """SELECT MAX(r.player_net) as v FROM rounds r
                   JOIN games g ON g.id = r.game_id
                   WHERE g.profile_id = ?""",
                (profile_id,)
            ).fetchone()['v']

            # Average score per round
            avg_round = conn.execute(
                """SELECT AVG(r.player_net) as v FROM rounds r
                   JOIN games g ON g.id = r.game_id
                   WHERE g.profile_id = ?""",
                (profile_id,)
            ).fetchone()['v']

            # Win streak (current)
            recent = conn.execute(
                """SELECT result FROM games
                   WHERE profile_id = ? AND result != 'in_progress'
                   ORDER BY finished_at DESC""",
                (profile_id,)
            ).fetchall()

            streak = 0
            for r in recent:
                if r['result'] == 'win':
                    streak += 1
                else:
                    break

            # Best streak
            best_streak = 0
            current = 0
            for r in recent:
                if r['result'] == 'win':
                    current += 1
                    best_streak = max(best_streak, current)
                else:
                    current = 0

            # Per-difficulty stats
            by_difficulty = {}
            for diff in ('easy', 'medium', 'hard'):
                d_total = conn.execute(
                    "SELECT COUNT(*) as c FROM games "
                    "WHERE profile_id = ? AND difficulty = ? AND result != 'in_progress'",
                    (profile_id, diff)
                ).fetchone()['c']
                d_wins = conn.execute(
                    "SELECT COUNT(*) as c FROM games WHERE profile_id = ? AND difficulty = ? AND result = 'win'",
                    (profile_id, diff)
                ).fetchone()['c']
                by_difficulty[diff] = {
                    'played': d_total,
                    'wins': d_wins,
                    'win_rate': round(d_wins / d_total * 100) if d_total > 0 else 0,
                }

            return {
                'total_games': total,
                'wins': wins,
                'losses': losses,
                'win_rate': round(wins / total * 100) if total > 0 else 0,
                'best_game_score': best_game or 0,
                'best_round_score': best_round or 0,
                'avg_round_score': round(avg_round, 1) if avg_round else 0,
                'current_streak': streak,
                'best_streak': best_streak,
                'by_difficulty': by_difficulty,
            }
