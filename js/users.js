/* ══════════════════════════════════════════════════════════
   USER MANAGER — multi-user profiles with per-user data isolation
   ══════════════════════════════════════════════════════════
   Manages user profiles stored in localStorage under the key
   'doddgames_users'. Each user gets an isolated history key
   ('doddgames_history_<userId>') so scores, streaks, sparklines,
   and the cognitive profile dashboard are scoped per person.

   Guest mode: when no user is active (activeUserId === null),
   the app falls back to the original 'doddgames_history' key,
   preserving backward compatibility for single-user workflows.

   Migration: on first load, if existing history data is found
   under the legacy global key, it is copied to a new "Player 1"
   profile so no data is lost.
   ══════════════════════════════════════════════════════════ */
export class UserManager {
    constructor() {
        this.REGISTRY_KEY = 'doddgames_users';
        this.registry = this._load();

        // One-time migration from single-user to multi-user
        if (!this.registry) {
            this.registry = { users: {}, activeUserId: null };
            this._migrate();
        }
    }

    // ── Read/write registry ──────────────────────────────────────────────────

    _load() {
        try {
            const raw = localStorage.getItem(this.REGISTRY_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.users === 'object') return parsed;
            return null;
        } catch { return null; }
    }

    _save() {
        localStorage.setItem(this.REGISTRY_KEY, JSON.stringify(this.registry));
    }

    // ── Migration ────────────────────────────────────────────────────────────

    _migrate() {
        const existingHistory = localStorage.getItem('doddgames_history');
        if (!existingHistory) return; // No data to migrate

        try {
            const parsed = JSON.parse(existingHistory);
            if (!Array.isArray(parsed) || parsed.length === 0) return;
        } catch { return; }

        // Create "Player 1" and copy existing data
        const id = this._generateId();
        const ageBracket = localStorage.getItem('doddgames_age_bracket') || '';
        const colorblind = localStorage.getItem('doddgames_colorblind') === 'true';

        this.registry.users[id] = {
            id,
            name: 'Player 1',
            color: '#7b2ff7',
            ageBracket,
            colorblind,
            createdAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
        };
        this.registry.activeUserId = id;

        // Copy history to user-specific key (original key stays as guest fallback)
        localStorage.setItem(`doddgames_history_${id}`, existingHistory);
        this._save();
    }

    // ── ID generation ────────────────────────────────────────────────────────

    _generateId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    // ── Public API ───────────────────────────────────────────────────────────

    // Returns all user profiles sorted by lastActiveAt descending
    getUsers() {
        return Object.values(this.registry.users)
            .sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));
    }

    // Returns the active user's profile, or null if in guest mode
    getActiveUser() {
        if (!this.registry.activeUserId) return null;
        return this.registry.users[this.registry.activeUserId] || null;
    }

    // Creates a new user, sets them as active, and returns the profile
    createUser(name, color) {
        const trimmed = (name || '').trim().slice(0, 20) || 'User';
        const id = this._generateId();
        const profile = {
            id,
            name: trimmed,
            color: color || '#7b2ff7',
            ageBracket: '',
            colorblind: false,
            createdAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
        };
        this.registry.users[id] = profile;
        this.registry.activeUserId = id;

        // Create empty history for this user
        localStorage.setItem(`doddgames_history_${id}`, '[]');
        this._save();
        this._fireChange();
        return profile;
    }

    renameUser(userId, newName) {
        const user = this.registry.users[userId];
        if (!user) return;
        user.name = (newName || '').trim().slice(0, 20) || user.name;
        this._save();
        this._fireChange();
    }

    deleteUser(userId) {
        if (!this.registry.users[userId]) return;

        // Remove history data
        localStorage.removeItem(`doddgames_history_${userId}`);

        // Remove from registry
        delete this.registry.users[userId];

        // Switch to next available user or guest mode
        if (this.registry.activeUserId === userId) {
            const remaining = this.getUsers();
            this.registry.activeUserId = remaining.length > 0 ? remaining[0].id : null;
        }

        this._save();
        this._fireChange();
    }

    switchUser(userId) {
        if (!this.registry.users[userId]) return;
        this.registry.activeUserId = userId;
        this.registry.users[userId].lastActiveAt = new Date().toISOString();
        this._save();
        this._fireChange();
    }

    enterGuestMode() {
        this.registry.activeUserId = null;
        this._save();
        this._fireChange();
    }

    updateUserSettings(userId, settings) {
        const user = this.registry.users[userId];
        if (!user) return;
        if ('ageBracket' in settings) user.ageBracket = settings.ageBracket;
        if ('colorblind' in settings) user.colorblind = settings.colorblind;
        this._save();
    }

    // Returns the localStorage key for the active user's history
    getActiveHistoryKey() {
        if (this.registry.activeUserId) {
            return `doddgames_history_${this.registry.activeUserId}`;
        }
        return 'doddgames_history';
    }

    // Update lastActiveAt timestamp (called on score save)
    touchActiveUser() {
        const user = this.getActiveUser();
        if (user) {
            user.lastActiveAt = new Date().toISOString();
            this._save();
        }
    }

    // ── Preset colors for the user avatar picker ─────────────────────────────

    static AVATAR_COLORS = [
        '#7b2ff7', '#e74c3c', '#3498db', '#2ecc71',
        '#f39c12', '#e91e63', '#00bcd4', '#ff5722',
        '#9c27b0', '#4caf50',
    ];

    // ── Event dispatch ───────────────────────────────────────────────────────

    _fireChange() {
        window.dispatchEvent(new Event('userChanged'));
    }
}
