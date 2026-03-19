/* ══════════════════════════════════════════════════════════
   APP CONTROLLER — navigation, timer, countdown, settings
   ══════════════════════════════════════════════════════════
   Singleton controller mounted as window.app.
   Owns all game instances, the session timer, the countdown
   overlay, and cross-cutting concerns (audio, scores, visibility).

   Game interface contract — every game module must expose:
     constructor(app)          receives the App singleton
     init()                    set up DOM/state, start gameplay
     cleanup()                 tear down listeners/timers/state
     getResults()              returns { data, displayText, summary }
                               or null if no scoreable result
   ══════════════════════════════════════════════════════════ */
import { AudioManager } from './audio.js';
import { ScoreManager } from './scores.js';
import { UserManager } from './users.js';
import { SchulteGame } from './games/schulte.js';
import { TetrisGame } from './games/tetris.js';
import { StroopGame } from './games/stroop.js';
import { TrailsAGame } from './games/trails-a.js';
import { GoNoGoGame } from './games/gonogo.js';
import { TrailsBGame } from './games/trails-b.js';
import { CardSortGame } from './games/card-sort.js';
import { TowerGame } from './games/tower.js';
import { SymbolDigitGame } from './games/symbol-digit.js';
import { WordListGame } from './games/word-list.js';
import { CPTGame } from './games/cpt.js';
import { ProfileManager } from './profile.js';

class App {
    /**
     * Constructs the singleton App controller.
     * Instantiates every game and support service, builds the GAMES
     * routing map, wires all persistent UI event listeners, and
     * triggers the initial score render on the landing screen.
     */
    constructor() {
        // Session length shared by all games (seconds)
        this.SESSION_DURATION = 5 * 60;
        // Key string of the currently active game, or null on the landing screen
        this.currentGame = null;
        this.timerInterval = null;
        this.timeLeft = this.SESSION_DURATION;
        // True while the session timer is frozen (tab hidden or explicit pause)
        this.gamePaused = false;

        this.audio = new AudioManager();
        this.users = new UserManager();
        this.scores = new ScoreManager(this.users.getActiveHistoryKey());
        this.schulte = new SchulteGame(this);
        this.tetris = new TetrisGame(this);
        this.stroop = new StroopGame(this);
        this.trailsA = new TrailsAGame(this);
        this.gonogo = new GoNoGoGame(this);
        this.trailsB = new TrailsBGame(this);
        this.cardSort = new CardSortGame(this);
        this.tower = new TowerGame(this);
        this.symbolDigit = new SymbolDigitGame(this);
        this.wordList = new WordListGame(this);
        this.cpt = new CPTGame(this);
        this.profile = new ProfileManager(this.scores);

        // Tracks whether the game was running before the tab was hidden,
        // so _handleVisibilityChange() knows whether to resume on return.
        this._wasRunningBeforeHide = false;

        // All game types for routing — keyed by the string used in HTML
        // data attributes and passed to startGame(). Adding a new game
        // only requires registering it here and creating a matching
        // <section id="<key>-screen"> in the HTML.
        this.GAMES = {
            'schulte': this.schulte,
            'tetris': this.tetris,
            'stroop': this.stroop,
            'trails-a': this.trailsA,
            'gonogo': this.gonogo,
            'trails-b': this.trailsB,
            'card-sort': this.cardSort,
            'tower': this.tower,
            'symbol-digit': this.symbolDigit,
            'word-list': this.wordList,
            'cpt': this.cpt,
        };

        // Sound toggle
        document.getElementById('sound-toggle').addEventListener('click', () => this.audio.toggleMute());

        // Settings panel toggle
        const settingsBtn = document.getElementById('settings-toggle');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                document.getElementById('settings-panel').classList.toggle('open');
            });
        }

        // Profile button
        const profileBtn = document.querySelector('.profile-btn');
        if (profileBtn) {
            profileBtn.title = 'Cognitive Profile';
            profileBtn.addEventListener('click', () => this.showProfile());
        }

        // Age bracket selector — per-user when a user is active, else global
        const ageSel = document.getElementById('age-bracket');
        if (ageSel) {
            const activeUser = this.users.getActiveUser();
            ageSel.value = activeUser ? (activeUser.ageBracket || '') : (localStorage.getItem('doddgames_age_bracket') || '');
            ageSel.addEventListener('change', () => {
                const user = this.users.getActiveUser();
                if (user) {
                    this.users.updateUserSettings(user.id, { ageBracket: ageSel.value });
                } else {
                    localStorage.setItem('doddgames_age_bracket', ageSel.value);
                }
            });
        }

        // User switcher — dropdown toggle, create, and guest mode buttons
        this._initUserSwitcher();

        // Listen for user changes (fired by UserManager on switch/create/delete)
        window.addEventListener('userChanged', () => this._onUserChanged());

        // Visibility API — auto-pause on tab switch
        document.addEventListener('visibilitychange', () => this._handleVisibilityChange());

        // Fullscreen buttons
        document.querySelectorAll('.fullscreen-btn').forEach(btn => {
            btn.addEventListener('click', () => this._toggleFullscreen());
        });
        document.addEventListener('fullscreenchange', () => this._updateFullscreenButtons());
        if (!document.fullscreenEnabled) {
            document.querySelectorAll('.fullscreen-btn').forEach(b => b.style.display = 'none');
        }

        // Global pause key handler — spacebar pauses most games,
        // Escape/P pauses Go/No-Go and CPT where spacebar is a game response
        this._pauseKeyHandler = (e) => this._handlePauseKey(e);
        document.addEventListener('keydown', this._pauseKeyHandler);

        // Resume button on pause overlay
        const resumeBtn = document.getElementById('pause-resume-btn');
        if (resumeBtn) resumeBtn.addEventListener('click', () => this.togglePause());

        // Initial render
        this._renderUserSwitcher();
        this.scores.renderAll();
    }

    /**
     * Handles the Page Visibility API `visibilitychange` event.
     *
     * On hide: freezes the session timer by setting gamePaused = true.
     * Tetris requires extra handling because its gameplay loop runs via
     * requestAnimationFrame — simply pausing the timer is not enough;
     * tetris.paused must also be set so the rAF loop idles, and the
     * drop counters are reset on resume to prevent a catch-up drop.
     * The AudioContext is suspended to silence any in-flight tones.
     *
     * On show: restores the previous running state and resumes audio
     * only if the game was actually running when the tab was hidden.
     */
    _handleVisibilityChange() {
        if (document.hidden) {
            this._wasRunningBeforeHide = this.currentGame !== null && !this.gamePaused;
            if (this.currentGame && !this.gamePaused) {
                if (this.currentGame === 'tetris') {
                    // Tetris uses an rAF loop, so its own paused flag must be
                    // set in addition to the shared gamePaused flag
                    this.tetris.paused = true;
                    this.gamePaused = true;
                    document.getElementById('tetris-timer').classList.add('paused-flash');
                } else {
                    this.gamePaused = true;
                }
            }
            if (this.audio.ctx && this.audio.ctx.state === 'running') {
                this.audio.ctx.suspend();
            }
        } else {
            if (this._wasRunningBeforeHide && this.currentGame) {
                if (this.currentGame === 'tetris') {
                    // Reset timing state so Tetris doesn't instantly drop pieces
                    // to compensate for time elapsed while the tab was hidden
                    this.tetris.paused = false;
                    this.tetris.lastTime = performance.now();
                    this.tetris.dropCounter = 0;
                    document.getElementById('tetris-timer').classList.remove('paused-flash');
                }
                this.gamePaused = false;
            }
            this._wasRunningBeforeHide = false;
            if (this.audio.ctx && this.audio.ctx.state === 'suspended') {
                this.audio.ctx.resume();
            }
        }
    }

    /**
     * Toggles the browser's native fullscreen mode for the entire page.
     * Errors are silently swallowed (e.g. permission denied on some browsers).
     */
    _toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    }

    /**
     * Updates every fullscreen button's icon and tooltip to reflect the
     * current fullscreen state. Called in response to the `fullscreenchange`
     * event so buttons stay in sync even when the user exits via Escape.
     */
    _updateFullscreenButtons() {
        const isFS = !!document.fullscreenElement;
        document.querySelectorAll('.fullscreen-btn').forEach(btn => {
            btn.textContent = isFS ? '\u2716' : '\u26F6';
            btn.title = isFS ? 'Exit Fullscreen' : 'Fullscreen';
        });
    }

    // ── Pause system ──────────────────────────────────────────────────────

    /**
     * Games where spacebar is the primary response key.
     * These games use Escape or P to pause instead of Space.
     */
    static SPACE_RESPONSE_GAMES = new Set(['gonogo', 'cpt']);

    /**
     * Handles global keydown events for pause toggling.
     * - Tetris handles its own pause internally (Space key); skip here.
     * - Go/No-Go and CPT use Space as a response, so only Escape/P pauses.
     * - All other games pause on Space, Escape, or P.
     */
    _handlePauseKey(e) {
        if (!this.currentGame) return;
        // Tetris manages its own pause
        if (this.currentGame === 'tetris') return;
        // Don't intercept when typing in an input (word-list recall)
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const isSpaceGame = App.SPACE_RESPONSE_GAMES.has(this.currentGame);

        if (this.gamePaused) {
            // While paused, any of the pause keys resumes
            if (e.key === ' ' || e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                this.togglePause();
            }
            return;
        }

        // Not paused — check if this key should trigger pause
        if (isSpaceGame) {
            // Only Escape or P pauses these games (Space is game response)
            if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                this.togglePause();
            }
        } else {
            // Space, Escape, or P pauses all other games
            if (e.key === ' ' || e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                this.togglePause();
            }
        }
    }

    /**
     * Toggles the global pause state and shows/hides the pause overlay.
     * Sets gamePaused which the session timer already respects.
     * Games can check app.gamePaused to freeze their own logic.
     */
    togglePause() {
        if (!this.currentGame || this.currentGame === 'tetris') return;

        this.gamePaused = !this.gamePaused;

        const overlay = document.getElementById('pause-overlay');
        const hint = document.getElementById('pause-hint');
        const timerEl = document.getElementById(`${this.currentGame}-timer`);

        if (this.gamePaused) {
            overlay.classList.add('active');
            if (timerEl) timerEl.classList.add('paused-flash');
            // Show correct key hint
            const isSpaceGame = App.SPACE_RESPONSE_GAMES.has(this.currentGame);
            if (hint) hint.textContent = isSpaceGame
                ? 'Press Escape or P to resume'
                : 'Press Space to resume';
            // Suspend audio
            if (this.audio.ctx && this.audio.ctx.state === 'running') {
                this.audio.ctx.suspend();
            }
        } else {
            overlay.classList.remove('active');
            if (timerEl) timerEl.classList.remove('paused-flash');
            // Resume audio
            if (this.audio.ctx && this.audio.ctx.state === 'suspended') {
                this.audio.ctx.resume();
            }
        }
    }

    /**
     * Navigates from the landing screen to a game.
     * Hides the landing screen, plays the 3-2-1-GO countdown overlay,
     * then activates the game's screen element, resets the session timer
     * to SESSION_DURATION, and calls the game's init() method.
     *
     * @param {string} game - Key from the GAMES map (e.g. 'schulte', 'tetris')
     */
    startGame(game) {
        this.currentGame = game;
        this.gamePaused = false;
        document.getElementById('landing').style.display = 'none';
        // Disable user switching during game to prevent saving to wrong user
        const switcherBtn = document.getElementById('user-switcher-btn');
        if (switcherBtn) switcherBtn.disabled = true;

        // Show pause key hint appropriate to the game
        const pauseHint = document.getElementById('pause-key-hint');
        if (pauseHint) {
            if (game === 'tetris') {
                pauseHint.textContent = 'Space to pause';
            } else if (App.SPACE_RESPONSE_GAMES.has(game)) {
                pauseHint.textContent = 'Esc / P to pause';
            } else {
                pauseHint.textContent = 'Space to pause';
            }
            pauseHint.style.display = '';
        }

        this._showCountdown(() => {
            document.getElementById(`${game}-screen`).classList.add('active');
            this.timeLeft = this.SESSION_DURATION;
            this._updateTimerDisplay(game);
            this._startTimer(game);

            const gameObj = this.GAMES[game];
            if (gameObj) gameObj.init();
        });
    }

    /**
     * Displays the 3-2-1-GO countdown overlay and invokes `callback` when
     * the animation finishes.
     * Plays a beep on each count and a rising three-note chord on "GO!".
     * The overlay is removed 500 ms after "GO!" so the transition feels
     * snappy without immediately cutting to the game.
     *
     * @param {Function} callback - Called after the overlay is dismissed
     */
    _showCountdown(callback) {
        const overlay = document.getElementById('countdown-overlay');
        const numEl = document.getElementById('countdown-num');
        const labelEl = document.getElementById('countdown-label');
        overlay.classList.add('active');

        let count = 3;
        numEl.textContent = count;
        labelEl.textContent = 'Get ready...';
        this.audio.playBeep();

        const tick = () => {
            count--;
            if (count > 0) {
                numEl.textContent = count;
                // Force CSS animation restart by removing and re-adding it
                numEl.style.animation = 'none';
                void numEl.offsetWidth; // trigger reflow
                numEl.style.animation = 'countPop 0.5s ease-out';
                this.audio.playBeep();
                setTimeout(tick, 1000);
            } else {
                numEl.textContent = 'GO!';
                numEl.style.animation = 'none';
                void numEl.offsetWidth; // trigger reflow
                numEl.style.animation = 'countPop 0.5s ease-out';
                this.audio.playGo();
                setTimeout(() => {
                    overlay.classList.remove('active');
                    callback();
                }, 500);
            }
        };

        setTimeout(tick, 1000);
    }

    /**
     * Stops the current game and returns to the landing screen.
     * Calls cleanup() on the active game to release any resources
     * (event listeners, animation frames, etc.), then hides all game
     * screens and re-renders the score display on the landing screen.
     */
    goHome() {
        this.stopTimer();
        this.gamePaused = false;

        // Cleanup current game
        if (this.currentGame) {
            const gameObj = this.GAMES[this.currentGame];
            if (gameObj) gameObj.cleanup();
        }

        document.querySelectorAll('.game-screen').forEach(s => s.classList.remove('active'));
        document.getElementById('overlay-complete').classList.remove('active');
        document.getElementById('countdown-overlay').classList.remove('active');
        document.getElementById('pause-overlay').classList.remove('active');
        const pauseHint = document.getElementById('pause-key-hint');
        if (pauseHint) pauseHint.style.display = 'none';
        document.getElementById('landing').style.display = 'flex';
        this.currentGame = null;
        // Re-enable user switching
        const switcherBtn = document.getElementById('user-switcher-btn');
        if (switcherBtn) switcherBtn.disabled = false;
        this._renderUserSwitcher();
        this.scores.renderAll();
    }

    /**
     * Navigates to the cognitive profile screen and triggers a render.
     * Hides the landing screen and any active game screen before showing
     * the profile so only one top-level view is visible at a time.
     */
    showProfile() {
        document.getElementById('landing').style.display = 'none';
        document.querySelectorAll('.game-screen').forEach(s => s.classList.remove('active'));
        document.getElementById('profile-screen').classList.add('active');
        const profileName = document.getElementById('profile-user-name');
        const activeUser = this.users.getActiveUser();
        if (profileName) profileName.textContent = activeUser ? activeUser.name : 'Guest';
        this.profile.render();
    }

    /**
     * Starts the 1-second countdown interval for the active game session.
     * Any previously running interval is cleared first to prevent stacking.
     * The interval is a no-op while gamePaused is true, which allows the
     * same interval to survive tab-hide/show cycles without being restarted.
     * When timeLeft reaches 0 the interval is stopped and endSession() fires.
     *
     * @param {string} game - Key from the GAMES map, forwarded to timer display
     */
    _startTimer(game) {
        this.stopTimer();
        this.timerInterval = setInterval(() => {
            if (this.gamePaused) return;

            this.timeLeft--;
            this._updateTimerDisplay(game);
            if (this.timeLeft <= 0) {
                this.stopTimer();
                this.endSession(game);
            }
        }, 1000);
    }

    /**
     * Clears the active session timer interval.
     * Safe to call when no timer is running.
     */
    stopTimer() {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
    }

    /**
     * Writes the current time remaining into the game's timer element.
     * The display turns red when 30 seconds or fewer remain as a visual
     * warning to the player.
     *
     * @param {string} game - Key from the GAMES map; targets `<game>-timer` element
     */
    _updateTimerDisplay(game) {
        const m = Math.floor(this.timeLeft / 60);
        const s = this.timeLeft % 60;
        const display = `${m}:${String(s).padStart(2, '0')}`;
        const el = document.getElementById(`${game}-timer`);
        if (el) {
            el.textContent = display;
            el.style.color = this.timeLeft <= 30 ? '#e74c3c' : '#00d4ff';
        }
    }

    /**
     * Called when the session timer expires.
     * Calls the game's cleanup() and getResults() methods, saves the score
     * via ScoreManager, populates the end-of-session summary overlay, plays
     * the completion sound, and wires the replay button to restart the same
     * game via a fresh startGame() call.
     *
     * @param {string} game - Key from the GAMES map identifying the finished game
     */
    endSession(game) {
        const gameObj = this.GAMES[game];
        if (!gameObj) return;

        gameObj.cleanup();
        const results = gameObj.getResults();

        if (results) {
            this.scores.saveScore(game, results.data, results.displayText);
            this.users.touchActiveUser();
            document.getElementById('overlay-summary').innerHTML = results.summary;
        }

        this.audio.playComplete();

        document.getElementById('overlay-replay-btn').onclick = () => {
            document.getElementById('overlay-complete').classList.remove('active');
            document.querySelectorAll('.game-screen').forEach(s => s.classList.remove('active'));
            this.startGame(game);
        };
        document.getElementById('overlay-complete').classList.add('active');
    }

    // ── User management ─────────────────────────────────────────────────────

    /**
     * Wires event listeners for user-switcher dropdown, user modal,
     * and all user CRUD buttons in the header.
     */
    _initUserSwitcher() {
        // Toggle dropdown
        const switcherBtn = document.getElementById('user-switcher-btn');
        if (switcherBtn) {
            switcherBtn.addEventListener('click', () => {
                document.getElementById('user-dropdown').classList.toggle('open');
                // Close settings panel if open
                document.getElementById('settings-panel').classList.remove('open');
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('user-dropdown');
            const btn = document.getElementById('user-switcher-btn');
            if (dropdown && btn && !dropdown.contains(e.target) && !btn.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });

        // "Add User" button in dropdown
        const addBtn = document.getElementById('user-add-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                document.getElementById('user-dropdown').classList.remove('open');
                this._openUserModal();
            });
        }

        // Guest mode button in dropdown
        const guestBtn = document.getElementById('user-guest-btn');
        if (guestBtn) {
            guestBtn.addEventListener('click', () => {
                document.getElementById('user-dropdown').classList.remove('open');
                this.users.enterGuestMode();
            });
        }

        // User modal — save / cancel / delete
        const modalSave = document.getElementById('user-modal-save');
        if (modalSave) modalSave.addEventListener('click', () => this._saveUserModal());

        const modalCancel = document.getElementById('user-modal-cancel');
        if (modalCancel) modalCancel.addEventListener('click', () => this._closeUserModal());

        const modalDelete = document.getElementById('user-modal-delete');
        if (modalDelete) modalDelete.addEventListener('click', () => this._deleteFromModal());

        // Color picker circles in modal
        document.querySelectorAll('.user-color-option').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.user-color-option').forEach(c => c.classList.remove('selected'));
                el.classList.add('selected');
            });
        });

        // Export All Users button
        const exportAllBtn = document.getElementById('export-all-btn');
        if (exportAllBtn) {
            exportAllBtn.addEventListener('click', () => this._exportAllUsers());
        }
    }

    /**
     * Rebuilds the user dropdown list and updates the switcher button
     * to show the active user's avatar and name.
     */
    _renderUserSwitcher() {
        const btn = document.getElementById('user-switcher-btn');
        const list = document.getElementById('user-dropdown-list');
        if (!btn || !list) return;

        const activeUser = this.users.getActiveUser();
        const avatar = btn.querySelector('.user-avatar');
        const nameEl = btn.querySelector('.user-switcher-name');

        if (activeUser) {
            avatar.style.background = activeUser.color;
            nameEl.textContent = activeUser.name;
        } else {
            avatar.style.background = '#555';
            nameEl.textContent = 'Guest';
        }

        // Rebuild user list
        list.innerHTML = '';
        const users = this.users.getUsers();
        users.forEach(u => {
            const item = document.createElement('div');
            item.className = 'user-dropdown-item' + (activeUser && u.id === activeUser.id ? ' active' : '');

            const av = document.createElement('span');
            av.className = 'user-avatar';
            av.style.background = u.color;

            const name = document.createElement('span');
            name.className = 'user-item-name';
            name.textContent = u.name;

            const editBtn = document.createElement('button');
            editBtn.className = 'user-edit-btn';
            editBtn.textContent = '\u270E';
            editBtn.title = 'Edit user';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('user-dropdown').classList.remove('open');
                this._openUserModal(u);
            });

            item.appendChild(av);
            item.appendChild(name);
            item.appendChild(editBtn);
            item.addEventListener('click', () => {
                document.getElementById('user-dropdown').classList.remove('open');
                this.users.switchUser(u.id);
            });
            list.appendChild(item);
        });

        // Update profile screen user name
        const profileName = document.getElementById('profile-user-name');
        if (profileName) {
            profileName.textContent = activeUser ? activeUser.name : 'Guest';
        }

        // Update settings label
        const settingsLabel = document.getElementById('settings-user-label');
        if (settingsLabel) {
            settingsLabel.textContent = activeUser ? `Settings for ${activeUser.name}` : 'Settings (Guest)';
        }

        // Disable user switcher during active game
        const switcherBtnEl = document.getElementById('user-switcher-btn');
        if (switcherBtnEl) {
            switcherBtnEl.disabled = this.currentGame !== null;
        }
    }

    /**
     * Called when the active user changes (switch, create, delete).
     * Rebuilds ScoreManager and ProfileManager with the new user's
     * history key, reloads settings, and re-renders all data views.
     */
    _onUserChanged() {
        // Rebuild data managers with new user's history
        this.scores = new ScoreManager(this.users.getActiveHistoryKey());
        this.profile = new ProfileManager(this.scores);

        // Reload age bracket for new user
        const ageSel = document.getElementById('age-bracket');
        if (ageSel) {
            const user = this.users.getActiveUser();
            ageSel.value = user ? (user.ageBracket || '') : (localStorage.getItem('doddgames_age_bracket') || '');
        }

        // Re-render UI
        this._renderUserSwitcher();
        this.scores.renderAll();
    }

    /**
     * Opens the user modal for creating or editing a user.
     * @param {object} [user] - If provided, edit mode; otherwise create mode.
     */
    _openUserModal(user = null) {
        const modal = document.getElementById('user-modal');
        const nameInput = document.getElementById('user-modal-name');
        const deleteBtn = document.getElementById('user-modal-delete');
        const title = document.getElementById('user-modal-title');

        this._editingUserId = user ? user.id : null;
        title.textContent = user ? 'Edit User' : 'New User';
        nameInput.value = user ? user.name : '';
        deleteBtn.style.display = user ? 'inline-block' : 'none';

        // Select color
        const selectedColor = user ? user.color : UserManager.AVATAR_COLORS[0];
        document.querySelectorAll('.user-color-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.color === selectedColor);
        });

        modal.classList.add('active');
        nameInput.focus();
    }

    /** Closes the user modal without saving. */
    _closeUserModal() {
        document.getElementById('user-modal').classList.remove('active');
        this._editingUserId = null;
    }

    /** Saves the user modal — creates or renames depending on _editingUserId. */
    _saveUserModal() {
        const name = document.getElementById('user-modal-name').value.trim();
        if (!name) return;

        const selectedColorEl = document.querySelector('.user-color-option.selected');
        const color = selectedColorEl ? selectedColorEl.dataset.color : '#7b2ff7';

        if (this._editingUserId) {
            this.users.renameUser(this._editingUserId, name);
            // Update color
            const user = this.users.registry.users[this._editingUserId];
            if (user) {
                user.color = color;
                this.users._save();
                this.users._fireChange();
            }
        } else {
            this.users.createUser(name, color);
        }

        this._closeUserModal();
    }

    /** Deletes the user being edited, with confirmation. */
    _deleteFromModal() {
        if (!this._editingUserId) return;
        const user = this.users.registry.users[this._editingUserId];
        if (!user) return;

        if (confirm(`Delete "${user.name}" and all their history?`)) {
            this.users.deleteUser(this._editingUserId);
            this._closeUserModal();
        }
    }

    /**
     * Exports all users and their histories as a single JSON backup.
     */
    _exportAllUsers() {
        const allData = {
            users: this.users.registry,
            histories: {},
        };
        for (const userId of Object.keys(this.users.registry.users)) {
            const key = `doddgames_history_${userId}`;
            try {
                allData.histories[userId] = JSON.parse(localStorage.getItem(key)) || [];
            } catch { allData.histories[userId] = []; }
        }
        // Include guest history if it exists
        try {
            allData.histories['guest'] = JSON.parse(localStorage.getItem('doddgames_history')) || [];
        } catch { allData.histories['guest'] = []; }

        const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `doddgames-all-users-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

// Instantiate the singleton and expose it globally so game modules and
// inline HTML handlers can reach the controller via window.app
window.app = new App();
