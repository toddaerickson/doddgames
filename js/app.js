/* ==============================================================
   APP CONTROLLER — navigation, timer, countdown, auth
   ==============================================================
   Singleton controller mounted as window.app.
   Owns all game instances, the session timer, the countdown
   overlay, and cross-cutting concerns (audio, scores, auth).

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

        // User dropdown toggle
        this._initUserDropdown();

        // Auth form handlers
        this._initAuthForms();

        // Listen for user changes
        window.addEventListener('userChanged', () => this._onUserChanged());

        // Visibility API
        document.addEventListener('visibilitychange', () => this._handleVisibilityChange());

        // Fullscreen buttons
        document.querySelectorAll('.fullscreen-btn').forEach(btn => {
            btn.addEventListener('click', () => this._toggleFullscreen());
        });
        document.addEventListener('fullscreenchange', () => this._updateFullscreenButtons());
        if (!document.fullscreenEnabled) {
            document.querySelectorAll('.fullscreen-btn').forEach(b => b.style.display = 'none');
        }

        // Pause key handler
        this._pauseKeyHandler = (e) => this._handlePauseKey(e);
        document.addEventListener('keydown', this._pauseKeyHandler);

        const resumeBtn = document.getElementById('pause-resume-btn');
        if (resumeBtn) resumeBtn.addEventListener('click', () => this.togglePause());

        const mobilePauseBtn = document.getElementById('mobile-pause-btn');
        if (mobilePauseBtn) {
            mobilePauseBtn.addEventListener('click', () => this.togglePause());
        }

        // Async init
        this._asyncInit();
    }

    async _asyncInit() {
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

        await this.scores.loadFromServer();

        this._renderUserHeader();
        this.scores.renderAll();

        // Show login prompt if not logged in
        if (!this.users.getActiveUser()) {
            this._showAuthOverlay('login');
        }
    }

    // ── Auth UI ──────────────────────────────────────────────────────

    _initAuthForms() {
        // Toggle between login and register forms
        document.getElementById('show-register-btn').addEventListener('click', (e) => {
            e.preventDefault();
            this._showAuthOverlay('register');
        });
        document.getElementById('show-login-btn').addEventListener('click', (e) => {
            e.preventDefault();
            this._showAuthOverlay('login');
        });

        // Guest button
        document.getElementById('auth-guest-btn').addEventListener('click', () => {
            this._hideAuthOverlay();
        });

        // Login submit
        document.getElementById('login-submit-btn').addEventListener('click', () => this._doLogin());
        document.getElementById('login-password').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._doLogin();
        });

        // Register submit
        document.getElementById('register-submit-btn').addEventListener('click', () => this._doRegister());
        document.getElementById('register-password').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._doRegister();
        });

        // Color picker for register form
        document.querySelectorAll('.user-color-option').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.user-color-option').forEach(c => c.classList.remove('selected'));
                el.classList.add('selected');
            });
        });
    }

    _showAuthOverlay(mode) {
        const overlay = document.getElementById('auth-overlay');
        const loginForm = document.getElementById('auth-login-form');
        const registerForm = document.getElementById('auth-register-form');

        if (mode === 'register') {
            loginForm.style.display = 'none';
            registerForm.style.display = 'block';
        } else {
            loginForm.style.display = 'block';
            registerForm.style.display = 'none';
        }

        // Clear errors and fields
        document.getElementById('login-error').style.display = 'none';
        document.getElementById('register-error').style.display = 'none';

        overlay.classList.add('active');
    }

    _hideAuthOverlay() {
        document.getElementById('auth-overlay').classList.remove('active');
    }

    async _doLogin() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');

        if (!username || !password) {
            errorEl.textContent = 'Please enter username and password.';
            errorEl.style.display = 'block';
            return;
        }

        const result = await this.users.login(username, password);
        if (result.error) {
            errorEl.textContent = result.error;
            errorEl.style.display = 'block';
        } else {
            this._hideAuthOverlay();
            document.getElementById('login-username').value = '';
            document.getElementById('login-password').value = '';
        }
    }

    async _doRegister() {
        const username = document.getElementById('register-username').value.trim();
        const password = document.getElementById('register-password').value;
        const name = document.getElementById('register-name').value.trim();
        const errorEl = document.getElementById('register-error');
        const selectedColorEl = document.querySelector('.user-color-option.selected');
        const color = selectedColorEl ? selectedColorEl.dataset.color : '#7b2ff7';

        if (!username || !password) {
            errorEl.textContent = 'Username and password are required.';
            errorEl.style.display = 'block';
            return;
        }

        const result = await this.users.register(username, password, name || username, color);
        if (result.error) {
            errorEl.textContent = result.error;
            errorEl.style.display = 'block';
        } else {
            this._hideAuthOverlay();
            document.getElementById('register-username').value = '';
            document.getElementById('register-password').value = '';
            document.getElementById('register-name').value = '';
        }
    }

    // ── User Header ─────────────────────────────────────────────────

    _initUserDropdown() {
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

        // Logout button
        const logoutBtn = document.getElementById('user-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                document.getElementById('user-dropdown').classList.remove('open');
                await this.users.logout();
                this._showAuthOverlay('login');
            });
        }

        // Login button (shown when guest)
        const loginBtn = document.getElementById('user-login-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                document.getElementById('user-dropdown').classList.remove('open');
                this._showAuthOverlay('login');
            });
        }

        // Change password button
        const changePwBtn = document.getElementById('user-changepw-btn');
        if (changePwBtn) {
            changePwBtn.addEventListener('click', () => {
                document.getElementById('user-dropdown').classList.remove('open');
                this._showChangePwOverlay();
            });
        }

        // Change password form
        document.getElementById('changepw-submit-btn').addEventListener('click', () => this._doChangePassword());
        document.getElementById('changepw-cancel-btn').addEventListener('click', () => this._hideChangePwOverlay());
        document.getElementById('changepw-confirm').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._doChangePassword();
        });
    }

    _showChangePwOverlay() {
        document.getElementById('changepw-error').style.display = 'none';
        document.getElementById('changepw-success').style.display = 'none';
        document.getElementById('changepw-current').value = '';
        document.getElementById('changepw-new').value = '';
        document.getElementById('changepw-confirm').value = '';
        document.getElementById('changepw-overlay').classList.add('active');
        document.getElementById('changepw-current').focus();
    }

    _hideChangePwOverlay() {
        document.getElementById('changepw-overlay').classList.remove('active');
    }

    async _doChangePassword() {
        const current = document.getElementById('changepw-current').value;
        const newPw = document.getElementById('changepw-new').value;
        const confirm = document.getElementById('changepw-confirm').value;
        const errorEl = document.getElementById('changepw-error');
        const successEl = document.getElementById('changepw-success');

        errorEl.style.display = 'none';
        successEl.style.display = 'none';

        if (!current || !newPw) {
            errorEl.textContent = 'All fields are required.';
            errorEl.style.display = 'block';
            return;
        }
        if (newPw !== confirm) {
            errorEl.textContent = 'New passwords do not match.';
            errorEl.style.display = 'block';
            return;
        }
        if (newPw.length < 4) {
            errorEl.textContent = 'New password must be at least 4 characters.';
            errorEl.style.display = 'block';
            return;
        }

        const res = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.error || 'Failed to change password.';
            errorEl.style.display = 'block';
        } else {
            successEl.textContent = 'Password updated successfully.';
            successEl.style.display = 'block';
            document.getElementById('changepw-current').value = '';
            document.getElementById('changepw-new').value = '';
            document.getElementById('changepw-confirm').value = '';
        }
    }

    _renderUserHeader() {
        const btn = document.getElementById('user-switcher-btn');
        if (!btn) return;

        const activeUser = this.users.getActiveUser();
        const avatar = btn.querySelector('.user-avatar');
        const nameEl = document.getElementById('user-display-name');
        const logoutBtn = document.getElementById('user-logout-btn');
        const loginBtn = document.getElementById('user-login-btn');
        const changePwBtn = document.getElementById('user-changepw-btn');

        if (activeUser) {
            avatar.style.background = activeUser.color;
            nameEl.textContent = activeUser.name;
            if (logoutBtn) logoutBtn.style.display = 'block';
            if (changePwBtn) changePwBtn.style.display = 'block';
            if (loginBtn) loginBtn.style.display = 'none';
        } else {
            avatar.style.background = '#555';
            nameEl.textContent = 'Guest';
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (changePwBtn) changePwBtn.style.display = 'none';
            if (loginBtn) loginBtn.style.display = 'block';
        }

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
    }

    async _onUserChanged() {
        this.scores = new ScoreManager();
        await this.scores.loadFromServer();
        this.profile = new ProfileManager(this.scores);

        const ageSel = document.getElementById('age-bracket');
        if (ageSel) {
            const user = this.users.getActiveUser();
            ageSel.value = user ? (user.age_bracket || '') : '';
        }

        this._renderUserHeader();
        this.scores.renderAll();
    }

    // ── Visibility / Fullscreen / Pause ─────────────────────────────

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

    // ── Game Flow ───────────────────────────────────────────────────

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
        this._renderUserHeader();
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
