/* ==============================================================
   USER MANAGER — server-side profiles via /api/users
   ==============================================================
   Manages user profiles stored in the server's SQLite database.
   Each user gets isolated brain-game score history on the server.

   Guest mode: when no user is active (profile_id not in session),
   scores are stored with profile_id = NULL on the server.

   All methods that interact with the server are async.
   ============================================================== */
export class UserManager {
    constructor() {
        // Local cache of users and active user, populated by init()
        this._users = [];
        this._activeUser = null;
        this._ready = this._init();
    }

    async _init() {
        await this._refreshActiveUser();
        await this._refreshUsers();
    }

    /** Wait for initial data load to complete. */
    async ready() {
        await this._ready;
    }

    async _refreshActiveUser() {
        try {
            const res = await fetch('/api/users/active');
            const data = await res.json();
            this._activeUser = data.id ? data : null;
        } catch {
            this._activeUser = null;
        }
    }

    async _refreshUsers() {
        try {
            const res = await fetch('/api/users');
            this._users = await res.json();
        } catch {
            this._users = [];
        }
    }

    // ── Public API ───────────────────────────────────────────────────

    getUsers() {
        return this._users;
    }

    getActiveUser() {
        return this._activeUser;
    }

    async createUser(name, color) {
        const res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color }),
        });
        if (!res.ok) return null;
        const user = await res.json();
        this._activeUser = user;
        await this._refreshUsers();
        this._fireChange();
        return user;
    }

    async renameUser(userId, newName) {
        await fetch(`/api/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName }),
        });
        await this._refreshUsers();
        await this._refreshActiveUser();
        this._fireChange();
    }

    async deleteUser(userId) {
        await fetch(`/api/users/${userId}`, { method: 'DELETE' });
        await this._refreshUsers();
        await this._refreshActiveUser();
        this._fireChange();
    }

    async switchUser(userId) {
        const res = await fetch(`/api/users/${userId}/select`, { method: 'POST' });
        if (res.ok) {
            this._activeUser = await res.json();
            await this._refreshUsers();
            this._fireChange();
        }
    }

    async enterGuestMode() {
        await fetch('/api/users/guest', { method: 'POST' });
        this._activeUser = null;
        this._fireChange();
    }

    async updateUserSettings(userId, settings) {
        const body = {};
        if ('ageBracket' in settings) body.ageBracket = settings.ageBracket;
        if ('colorblind' in settings) body.colorblind = settings.colorblind;
        if ('color' in settings) body.color = settings.color;
        await fetch(`/api/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        await this._refreshActiveUser();
    }

    async touchActiveUser() {
        // Server updates last_active_at on score save, no separate call needed
    }

    // ── Preset colors for the user avatar picker ─────────────────────

    static AVATAR_COLORS = [
        '#7b2ff7', '#e74c3c', '#3498db', '#2ecc71',
        '#f39c12', '#e91e63', '#00bcd4', '#ff5722',
        '#9c27b0', '#4caf50',
    ];

    // ── Event dispatch ───────────────────────────────────────────────

    _fireChange() {
        window.dispatchEvent(new Event('userChanged'));
    }
}
