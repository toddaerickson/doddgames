"""Pytest coverage for the top-level server.py auth + score API.

Uses the Flask test client; each test gets a fresh client (isolated session)
and a wiped DB (see conftest.py).
"""


# ── 1. Auth register ──────────────────────────────────────────────────────

def test_register_success(client):
    resp = client.post("/api/auth/register", json={
        "username": "Alice", "password": "password123",
    })
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["id"] is not None
    assert body["username"] == "alice"  # lowercased
    assert body["name"] == "alice"      # defaults to username
    assert body["color"] == "#7b2ff7"


def test_register_with_name_and_color(client):
    resp = client.post("/api/auth/register", json={
        "username": "bob", "password": "password123",
        "name": "Bob Smith", "color": "#123abc",
    })
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["name"] == "Bob Smith"
    assert body["color"] == "#123abc"


def test_register_invalid_color_falls_back(client):
    resp = client.post("/api/auth/register", json={
        "username": "carol", "password": "password123", "color": "notacolor",
    })
    assert resp.status_code == 201
    assert resp.get_json()["color"] == "#7b2ff7"


def test_register_duplicate_username(client):
    client.post("/api/auth/register", json={
        "username": "dave", "password": "password123"})
    resp = client.post("/api/auth/register", json={
        "username": "dave", "password": "password456"})
    assert resp.status_code == 400
    assert "already taken" in resp.get_json()["error"]


def test_register_username_too_short(client):
    resp = client.post("/api/auth/register", json={
        "username": "ab", "password": "password123"})
    assert resp.status_code == 400
    assert "at least 3" in resp.get_json()["error"]


def test_register_username_too_long(client):
    resp = client.post("/api/auth/register", json={
        "username": "a" * 21, "password": "password123"})
    assert resp.status_code == 400
    assert "20 characters" in resp.get_json()["error"]


def test_register_username_invalid_chars(client):
    resp = client.post("/api/auth/register", json={
        "username": "bad name!", "password": "password123"})
    assert resp.status_code == 400
    assert "letters, numbers" in resp.get_json()["error"]


def test_register_password_too_short(client):
    resp = client.post("/api/auth/register", json={
        "username": "erin", "password": "short"})
    assert resp.status_code == 400
    assert "at least 8" in resp.get_json()["error"]


# ── 2. Auth login ─────────────────────────────────────────────────────────

def test_login_success(client):
    client.post("/api/auth/register", json={
        "username": "frank", "password": "password123"})
    # Logging out so we test login from a clean session.
    client.post("/api/auth/logout")
    resp = client.post("/api/auth/login", json={
        "username": "frank", "password": "password123"})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["username"] == "frank"
    assert "password_hash" not in body


def test_login_wrong_password(client):
    client.post("/api/auth/register", json={
        "username": "grace", "password": "password123"})
    resp = client.post("/api/auth/login", json={
        "username": "grace", "password": "wrongpassword"})
    assert resp.status_code == 401
    assert "Invalid username or password" in resp.get_json()["error"]


def test_login_unknown_user(client):
    resp = client.post("/api/auth/login", json={
        "username": "nobody", "password": "password123"})
    assert resp.status_code == 401
    assert "Invalid username or password" in resp.get_json()["error"]


def test_login_missing_fields(client):
    resp = client.post("/api/auth/login", json={"username": "heidi"})
    assert resp.status_code == 400
    assert "required" in resp.get_json()["error"]


# ── 3. Auth logout ────────────────────────────────────────────────────────

def test_logout_clears_session(client):
    client.post("/api/auth/register", json={
        "username": "ivan", "password": "password123"})
    resp = client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.get_json()["logged_out"] is True
    # me should now be Guest
    me = client.get("/api/auth/me").get_json()
    assert me["id"] is None
    assert me["name"] == "Guest"


# ── 4. Auth me ────────────────────────────────────────────────────────────

def test_me_guest_when_not_logged_in(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["id"] is None
    assert body["name"] == "Guest"


def test_me_returns_profile_after_login(client):
    client.post("/api/auth/register", json={
        "username": "judy", "password": "password123", "name": "Judy"})
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["username"] == "judy"
    assert body["name"] == "Judy"
    assert body["id"] is not None


# ── 5. Change password ────────────────────────────────────────────────────

def test_change_password_requires_login(client):
    resp = client.post("/api/auth/change-password", json={
        "currentPassword": "password123", "newPassword": "newpassword123"})
    assert resp.status_code == 401
    assert "Not logged in" in resp.get_json()["error"]


def test_change_password_wrong_current(client):
    client.post("/api/auth/register", json={
        "username": "kyle", "password": "password123"})
    resp = client.post("/api/auth/change-password", json={
        "currentPassword": "wrongpassword", "newPassword": "newpassword123"})
    assert resp.status_code == 401
    assert "incorrect" in resp.get_json()["error"]


def test_change_password_new_too_short(client):
    client.post("/api/auth/register", json={
        "username": "lana", "password": "password123"})
    resp = client.post("/api/auth/change-password", json={
        "currentPassword": "password123", "newPassword": "short"})
    assert resp.status_code == 400
    assert "at least 8" in resp.get_json()["error"]


def test_change_password_success_then_login(client):
    client.post("/api/auth/register", json={
        "username": "mona", "password": "password123"})
    resp = client.post("/api/auth/change-password", json={
        "currentPassword": "password123", "newPassword": "newpassword456"})
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True
    client.post("/api/auth/logout")
    # Old password no longer works
    bad = client.post("/api/auth/login", json={
        "username": "mona", "password": "password123"})
    assert bad.status_code == 401
    # New password works
    good = client.post("/api/auth/login", json={
        "username": "mona", "password": "newpassword456"})
    assert good.status_code == 200
    assert good.get_json()["username"] == "mona"


# ── 6. Rate limiting ──────────────────────────────────────────────────────

def test_login_rate_limited(client):
    # AUTH_RATE_LIMIT = 10. The 11th attempt from the same client is blocked.
    statuses = []
    for _ in range(11):
        r = client.post("/api/auth/login", json={
            "username": "noone", "password": "password123"})
        statuses.append(r.status_code)
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429
    assert "Too many attempts" in client.post(
        "/api/auth/login", json={"username": "noone", "password": "x"}
    ).get_json()["error"]


# ── 7. Score API allowlist ────────────────────────────────────────────────

def test_save_score_invalid_key(client):
    resp = client.post("/api/scores", json={"game": "not-a-real-game"})
    assert resp.status_code == 400
    assert "Invalid game key" in resp.get_json()["error"]


def test_save_score_missing_game(client):
    resp = client.post("/api/scores", json={"data": {"x": 1}})
    assert resp.status_code == 400
    assert "game is required" in resp.get_json()["error"]


def test_save_score_valid_keys(client):
    for key in ("schulte", "reversi"):
        resp = client.post("/api/scores", json={
            "game": key, "data": {"score": 42}, "displayText": "nice"})
        assert resp.status_code == 201, key
        assert resp.get_json()["saved"] is True


# ── 8. Scores GET / POST / clear / import ─────────────────────────────────

def test_post_then_get_score(client):
    client.post("/api/auth/register", json={
        "username": "nina", "password": "password123"})
    client.post("/api/scores", json={
        "game": "stroop", "data": {"score": 99}, "displayText": "99 pts"})
    resp = client.get("/api/scores")
    assert resp.status_code == 200
    rows = resp.get_json()
    assert len(rows) == 1
    assert rows[0]["game_key"] == "stroop"
    assert rows[0]["data"] == {"score": 99}
    assert rows[0]["display_text"] == "99 pts"


def test_get_score_game_filter(client):
    client.post("/api/auth/register", json={
        "username": "omar", "password": "password123"})
    client.post("/api/scores", json={"game": "stroop", "data": {}})
    client.post("/api/scores", json={"game": "tetris", "data": {}})
    only_tetris = client.get("/api/scores?game=tetris").get_json()
    assert len(only_tetris) == 1
    assert only_tetris[0]["game_key"] == "tetris"
    assert len(client.get("/api/scores").get_json()) == 2


def test_clear_scores(client):
    client.post("/api/auth/register", json={
        "username": "pat", "password": "password123"})
    client.post("/api/scores", json={"game": "schulte", "data": {}})
    assert len(client.get("/api/scores").get_json()) == 1
    resp = client.post("/api/scores/clear")
    assert resp.status_code == 200
    assert resp.get_json()["cleared"] is True
    assert client.get("/api/scores").get_json() == []


def test_import_scores_skips_invalid(client):
    client.post("/api/auth/register", json={
        "username": "quinn", "password": "password123"})
    resp = client.post("/api/scores/import", json={"entries": [
        {"game": "schulte", "data": {"a": 1}},
        {"game": "bogus-game", "data": {}},      # skipped
        {"game": "tetris", "data": {"b": 2}},
        {"data": {"no": "game key"}},            # skipped
    ]})
    assert resp.status_code == 201
    assert resp.get_json()["imported"] == 2
    assert len(client.get("/api/scores").get_json()) == 2


def test_import_scores_entries_not_list(client):
    resp = client.post("/api/scores/import", json={"entries": "nope"})
    assert resp.status_code == 400
    assert "must be an array" in resp.get_json()["error"]


# ── 9. User update authorization ──────────────────────────────────────────

def test_update_user_forbidden_for_other(client):
    body = client.post("/api/auth/register", json={
        "username": "rita", "password": "password123"}).get_json()
    other_id = body["id"] + 1
    resp = client.put(f"/api/users/{other_id}", json={"name": "Hacker"})
    assert resp.status_code == 403
    assert "Unauthorized" in resp.get_json()["error"]


def test_update_user_owner_succeeds(client):
    body = client.post("/api/auth/register", json={
        "username": "sam", "password": "password123"}).get_json()
    uid = body["id"]
    resp = client.put(f"/api/users/{uid}", json={
        "name": "Samuel", "color": "#abcdef"})
    assert resp.status_code == 200
    updated = resp.get_json()
    assert updated["name"] == "Samuel"
    assert updated["color"] == "#abcdef"


# ── 10. Health check ──────────────────────────────────────────────────────

def test_health_check(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok"}
