"""Profile model — CRUD for local player profiles (SQLite)."""

import sqlite3


class ProfileModel:
    def __init__(self, db_path: str):
        self.db_path = db_path

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def list_all(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, name, created_at FROM profiles ORDER BY name"
            ).fetchall()
            return [dict(r) for r in rows]

    def get(self, profile_id: int) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, name, created_at FROM profiles WHERE id = ?",
                (profile_id,)
            ).fetchone()
            return dict(row) if row else None

    def create(self, name: str) -> dict:
        name = name.strip()
        if not name:
            raise ValueError("Profile name cannot be empty")
        with self._conn() as conn:
            try:
                cursor = conn.execute(
                    "INSERT INTO profiles (name) VALUES (?)", (name,)
                )
                conn.commit()
                return self.get(cursor.lastrowid)
            except sqlite3.IntegrityError as err:
                raise ValueError(f"Profile '{name}' already exists") from err

    def delete(self, profile_id: int) -> bool:
        with self._conn() as conn:
            cursor = conn.execute(
                "DELETE FROM profiles WHERE id = ?", (profile_id,)
            )
            conn.commit()
            return cursor.rowcount > 0
