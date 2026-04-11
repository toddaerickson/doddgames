/* ==============================================================
   APP CONTROLLER — navigation, timer, countdown, settings
   ==============================================================
   Singleton controller mounted as window.app.
   Owns all game instances, the session timer, the countdown
   overlay, and cross-cutting concerns (audio, scores, visibility).

   Game interface contract — every game module must expose:
     constructor(app)          receives the App singleton
     init()                    set up DOM/state, start gameplay
     cleanup()                 tear down listeners/timers/state
     getResults()              returns { data, displayText, summary }
                               or null if no scoreable result
   ============================================================== */
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
import { DigitSpanGame } from './games/digit-span.js';
import { ProfileManager } from './profile.js';

class App {
    constructor() {
        // Session length shared by all games (seconds)
        this.SESSION_DURATION = 5 * 60;
        this.currentGame = null;
        this.timerInterval = null;
        this.timeLeft = this.SESSION_DURATION;
        this.gamePaused = false;

        this.audio = new AudioManager();
        this.users = new UserManager();
        this.scores = new ScoreManager();
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
        this.digitSpan = new DigitSpanGame(this);
        this.profile = new ProfileManager(this.scores);

        this._wasRunningBeforeHide = false;

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
            'digit-span': this.digitSpan,
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

        // Global pause key handler
        this._pauseKeyHandler = (e) => this._handlePauseKey(e);
        document.addEventListener('keydown', this._pauseKeyHandler);

        // Resume button on pause overlay
        const resumeBtn = document.getElementById('pause-resume-btn');
        if (resumeBtn) resumeBtn.addEventListener('click', () => this.togglePause());

        // Mobile pause button
        const mobilePauseBtn = document.getElementById('mobile-pause-btn');
        if (mobilePauseBtn) {
            mobilePauseBtn.addEventListener('click', () => this.togglePause());
        }

        // Login prompt — wire up buttons
        this._initLoginPrompt();

        // Async initialisation: load data from server then render
        this._asyncInit();
    }

    async _asyncInit() {
        // Wait for user data to load from server
        await this.users.ready();

        // Load age bracket from active user
        const ageSel = document.getElementById('age-bracket');
        if (ageSel) {
            const activeUser = this.users.getActiveUser();
            ageSel.value = activeUser ? (activeUser.age_bracket || '') : '';
            ageSel.addEventListener('change', async () => {
                const user = this.users.getActiveUser();
                if (user) {
                    await this.users.updateUserSettings(user.id, { ageBracket: ageSel.value });
                }
            });
        }

        // Load scores from server
        await this.scores.loadFromServer();

        // Initial render
        this._renderUserSwitcher();
        this.scores.renderAll();

        // Show login prompt on first load if no active user
        this._maybeShowLoginPrompt();
    }

    _handleVisibilityChange() {
        if (document.hidden) {
            this._wasRunningBeforeHide = this.currentGame !== null && !this.gamePaused;
            if (this.currentGame && !this.gamePaused) {
                if (this.currentGame === 'tetris') {
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

    _toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    }

    _updateFullscreenButtons() {
        const isFS = !!document.fullscreenElement;
        document.querySelectorAll('.fullscreen-btn').forEach(btn => {
            btn.textContent = isFS ? '\u2716' : '\u26F6';
            btn.title = isFS ? 'Exit Fullscreen' : 'Fullscreen';
        });
    }

    // ── Pause system ──────────────────────────────────────────────────────

    static SPACE_RESPONSE_GAMES = new Set(['gonogo', 'cpt']);

    _handlePauseKey(e) {
        if (!this.currentGame) return;
        if (this.currentGame === 'tetris') return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const isSpaceGame = App.SPACE_RESPONSE_GAMES.has(this.currentGame);

        if (this.gamePaused) {
            if (e.key === ' ' || e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                this.togglePause();
            }
            return;
        }

        if (isSpaceGame) {
            if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                this.togglePause();
            }
        } else {
            if (e.key === ' ' || e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                this.togglePause();
            }
        }
    }

    togglePause() {
        if (!this.currentGame || this.currentGame === 'tetris') return;

        this.gamePaused = !this.gamePaused;

        const overlay = document.getElementById('pause-overlay');
        const hint = document.getElementById('pause-hint');
        const timerEl = document.getElementById(`${this.currentGame}-timer`);

        if (this.gamePaused) {
            overlay.classList.add('active');
            if (timerEl) timerEl.classList.add('paused-flash');
            const isSpaceGame = App.SPACE_RESPONSE_GAMES.has(this.currentGame);
            if (hint) hint.textContent = isSpaceGame
                ? 'Press Escape or P to resume'
                : 'Press Space to resume';
            if (this.audio.ctx && this.audio.ctx.state === 'running') {
                this.audio.ctx.suspend();
            }
        } else {
            overlay.classList.remove('active');
            if (timerEl) timerEl.classList.remove('paused-flash');
            if (this.audio.ctx && this.audio.ctx.state === 'suspended') {
                this.audio.ctx.resume();
            }
        }
    }

    startGame(game) {
        this.currentGame = game;
        this.gamePaused = false;
        document.getElementById('landing').style.display = 'none';
        const switcherBtn = document.getElementById('user-switcher-btn');
        if (switcherBtn) switcherBtn.disabled = true;

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

        const mobilePauseBtn = document.getElementById('mobile-pause-btn');
        if (mobilePauseBtn) {
            if (game === 'tetris') {
                mobilePauseBtn.classList.remove('visible');
            } else {
                mobilePauseBtn.classList.add('visible');
            }
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
                numEl.style.animation = 'none';
                void numEl.offsetWidth;
                numEl.style.animation = 'countPop 0.5s ease-out';
                this.audio.playBeep();
                setTimeout(tick, 1000);
            } else {
                numEl.textContent = 'GO!';
                numEl.style.animation = 'none';
                void numEl.offsetWidth;
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

    goHome() {
        this.stopTimer();
        this.gamePaused = false;

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
        const mobilePauseBtn = document.getElementById('mobile-pause-btn');
        if (mobilePauseBtn) mobilePauseBtn.classList.remove('visible');
        document.getElementById('landing').style.display = 'flex';
        this.currentGame = null;
        const switcherBtn = document.getElementById('user-switcher-btn');
        if (switcherBtn) switcherBtn.disabled = false;
        this._renderUserSwitcher();
        this.scores.renderAll();
    }

    showProfile() {
        document.getElementById('landing').style.display = 'none';
        document.querySelectorAll('.game-screen').forEach(s => s.classList.remove('active'));
        document.getElementById('profile-screen').classList.add('active');
        const profileName = document.getElementById('profile-user-name');
        const activeUser = this.users.getActiveUser();
        if (profileName) profileName.textContent = activeUser ? activeUser.name : 'Guest';
        this.profile.render();
    }

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

    stopTimer() {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
    }

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

    async endSession(game) {
        const gameObj = this.GAMES[game];
        if (!gameObj) return;

        gameObj.cleanup();
        const results = gameObj.getResults();

        if (results) {
            await this.scores.saveScore(game, results.data, results.displayText);
            await this.users.touchActiveUser();
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

    _initUserSwitcher() {
        const switcherBtn = document.getElementById('user-switcher-btn');
        if (switcherBtn) {
            switcherBtn.addEventListener('click', () => {
                document.getElementById('user-dropdown').classList.toggle('open');
                document.getElementById('settings-panel').classList.remove('open');
            });
        }

        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('user-dropdown');
            const btn = document.getElementById('user-switcher-btn');
            if (dropdown && btn && !dropdown.contains(e.target) && !btn.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });

        const addBtn = document.getElementById('user-add-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                document.getElementById('user-dropdown').classList.remove('open');
                this._openUserModal();
            });
        }

        const guestBtn = document.getElementById('user-guest-btn');
        if (guestBtn) {
            guestBtn.addEventListener('click', async () => {
                document.getElementById('user-dropdown').classList.remove('open');
                await this.users.enterGuestMode();
            });
        }

        const modalSave = document.getElementById('user-modal-save');
        if (modalSave) modalSave.addEventListener('click', () => this._saveUserModal());

        const modalCancel = document.getElementById('user-modal-cancel');
        if (modalCancel) modalCancel.addEventListener('click', () => this._closeUserModal());

        const modalDelete = document.getElementById('user-modal-delete');
        if (modalDelete) modalDelete.addEventListener('click', () => this._deleteFromModal());

        document.querySelectorAll('.user-color-option').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.user-color-option').forEach(c => c.classList.remove('selected'));
                el.classList.add('selected');
            });
        });

        const exportAllBtn = document.getElementById('export-all-btn');
        if (exportAllBtn) {
            exportAllBtn.addEventListener('click', () => this._exportAllUsers());
        }
    }

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
            item.addEventListener('click', async () => {
                document.getElementById('user-dropdown').classList.remove('open');
                await this.users.switchUser(u.id);
            });
            list.appendChild(item);
        });

        const profileName = document.getElementById('profile-user-name');
        if (profileName) {
            profileName.textContent = activeUser ? activeUser.name : 'Guest';
        }

        const settingsLabel = document.getElementById('settings-user-label');
        if (settingsLabel) {
            settingsLabel.textContent = activeUser ? `Settings for ${activeUser.name}` : 'Settings (Guest)';
        }

        const switcherBtnEl = document.getElementById('user-switcher-btn');
        if (switcherBtnEl) {
            switcherBtnEl.disabled = this.currentGame !== null;
        }
    }

    async _onUserChanged() {
        // Reload scores from server for the new user
        this.scores = new ScoreManager();
        await this.scores.loadFromServer();
        this.profile = new ProfileManager(this.scores);

        const ageSel = document.getElementById('age-bracket');
        if (ageSel) {
            const user = this.users.getActiveUser();
            ageSel.value = user ? (user.age_bracket || '') : '';
        }

        this._renderUserSwitcher();
        this.scores.renderAll();
    }

    _openUserModal(user = null) {
        const modal = document.getElementById('user-modal');
        const nameInput = document.getElementById('user-modal-name');
        const deleteBtn = document.getElementById('user-modal-delete');
        const title = document.getElementById('user-modal-title');

        this._editingUserId = user ? user.id : null;
        title.textContent = user ? 'Edit User' : 'New User';
        nameInput.value = user ? user.name : '';
        deleteBtn.style.display = user ? 'inline-block' : 'none';

        const selectedColor = user ? user.color : UserManager.AVATAR_COLORS[0];
        document.querySelectorAll('.user-color-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.color === selectedColor);
        });

        modal.classList.add('active');
        nameInput.focus();
    }

    _closeUserModal() {
        document.getElementById('user-modal').classList.remove('active');
        this._editingUserId = null;
    }

    async _saveUserModal() {
        const name = document.getElementById('user-modal-name').value.trim();
        if (!name) return;

        const selectedColorEl = document.querySelector('.user-color-option.selected');
        const color = selectedColorEl ? selectedColorEl.dataset.color : '#7b2ff7';

        if (this._editingUserId) {
            await this.users.renameUser(this._editingUserId, name);
            await this.users.updateUserSettings(this._editingUserId, { color });
        } else {
            await this.users.createUser(name, color);
        }

        this._closeUserModal();
    }

    async _deleteFromModal() {
        if (!this._editingUserId) return;
        const users = this.users.getUsers();
        const user = users.find(u => u.id === this._editingUserId);
        if (!user) return;

        if (confirm(`Delete "${user.name}" and all their history?`)) {
            await this.users.deleteUser(this._editingUserId);
            this._closeUserModal();
        }
    }

    // ── Login prompt ─────────────────────────────────────────────────────

    _initLoginPrompt() {
        const newUserBtn = document.getElementById('login-new-user-btn');
        if (newUserBtn) {
            newUserBtn.addEventListener('click', () => {
                this._closeLoginPrompt();
                this._openUserModal();
            });
        }

        const guestBtn = document.getElementById('login-guest-btn');
        if (guestBtn) {
            guestBtn.addEventListener('click', () => {
                this._closeLoginPrompt();
            });
        }
    }

    _maybeShowLoginPrompt() {
        if (this.users.getActiveUser()) return;

        const modal = document.getElementById('login-prompt');
        const list = document.getElementById('login-user-list');
        if (!modal || !list) return;

        const users = this.users.getUsers();
        list.innerHTML = '';

        if (users.length > 0) {
            users.forEach(u => {
                const item = document.createElement('div');
                item.className = 'login-user-item';

                const avatar = document.createElement('span');
                avatar.className = 'user-avatar';
                avatar.style.background = u.color;

                const name = document.createElement('span');
                name.className = 'login-user-item-name';
                name.textContent = u.name;

                item.appendChild(avatar);
                item.appendChild(name);
                item.addEventListener('click', async () => {
                    await this.users.switchUser(u.id);
                    this._closeLoginPrompt();
                });
                list.appendChild(item);
            });
        }

        modal.classList.add('active');
    }

    _closeLoginPrompt() {
        const modal = document.getElementById('login-prompt');
        if (modal) modal.classList.remove('active');
    }

    _exportAllUsers() {
        const history = this.scores.getHistory();
        const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const activeUser = this.users.getActiveUser();
        const namePart = activeUser ? `-${activeUser.name.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
        a.download = `doddgames${namePart}-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

window.app = new App();
