/* ==============================================================
   USER MANAGER — authentication via /api/auth
   ==============================================================
   Manages user authentication with username + password.
   All data is stored server-side in SQLite; the Flask session
   cookie tracks who is logged in across browser restarts.

   Public API:
     await ready()              wait for initial auth check
     getActiveUser()            returns cached user or null
     async login(u, p)          log in, returns user or {error}
     async register(u,p,n,c)    create account, returns user or {error}
     async logout()             log out
     async updateUserSettings() update profile fields
   ============================================================== */
export class UserManager {
    constructor() {
        this._activeUser = null;
        this._ready = this._init();
    }

    async _init() {
        await this._refreshActiveUser();
    }

    async ready() {
        await this._ready;
    }

    async _refreshActiveUser() {
        try {
            const res = await fetch('/api/auth/me');
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            const data = await res.json();
            this._activeUser = data.id ? data : null;
        } catch (err) {
            console.warn('Failed to check auth status:', err);
            this._activeUser = null;
        }
    }

    // ── Public API ───────────────────────────────────────────────────

    getActiveUser() {
        return this._activeUser;
    }

    async login(username, password) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error || 'Login failed' };
        this._activeUser = data;
        this._fireChange();
        return data;
    }

    async register(username, password, name, color) {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, name, color }),
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error || 'Registration failed' };
        this._activeUser = data;
        this._fireChange();
        return data;
    }

    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (err) {
            console.warn('Logout request failed:', err);
        }
        this._activeUser = null;
        this._fireChange();
    }

    async updateUserSettings(userId, settings) {
        const body = {};
        if ('ageBracket' in settings) body.ageBracket = settings.ageBracket;
        if ('colorblind' in settings) body.colorblind = settings.colorblind;
        if ('color' in settings) body.color = settings.color;
        if ('name' in settings) body.name = settings.name;
        try {
            const res = await fetch(`/api/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) console.warn('Settings update returned', res.status);
        } catch (err) {
            console.warn('Failed to update settings:', err);
        }
        await this._refreshActiveUser();
    }

    async touchActiveUser() {
        // Server updates last_active_at on score save
    }

    // ── Preset colors for the avatar picker ──────────────────────────

    static AVATAR_COLORS = [
        '#4f8cff', '#e74c3c', '#3498db', '#2ecc71',
        '#f39c12', '#e91e63', '#00bcd4', '#ff5722',
        '#9c27b0', '#4caf50',
    ];

    // ── Event dispatch ───────────────────────────────────────────────

    _fireChange() {
        window.dispatchEvent(new Event('userChanged'));
    }
}
