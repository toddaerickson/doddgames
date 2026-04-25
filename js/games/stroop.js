/* ══════════════════════════════════════════════════════════
   STROOP CHALLENGE — Interference control + RT tracking
   ══════════════════════════════════════════════════════════

   Clinical background
   ───────────────────
   The Stroop effect is one of the most robust findings in cognitive
   psychology: naming the ink colour of an incongruent colour word
   (e.g. the word "RED" printed in blue ink → answer "Blue") is
   slower and more error-prone than naming a congruent word.

   The interference score (incongruent RT − congruent RT) isolates
   the cost of suppressing automatic word reading and is the primary
   clinical metric for inhibitory control.

   Design notes
   ────────────
   - 80% of trials are forced incongruent to maximise diagnostic data.
   - Three difficulty levels control palette size (4 / 6 / 8 colours)
     and feedback delay (600 / 400 / 250 ms) — more colours + shorter
     delay = harder.
   - Colorblind-safe palette (Wong 2011 / IBM) toggled via settings.
   - Keyboard shortcuts (1–N) map to button positions for fast play.
   - RT measured via performance.now() from stimulus onset to response.

   Interface contract
   ──────────────────
     constructor(app)  — receives global app object
     init()            — resets state, builds buttons, starts first trial
     cleanup()         — removes keydown listener
     getResults()      — returns { data, displayText, summary }
   ══════════════════════════════════════════════════════════ */
export class StroopGame {
    /*
     * Constructor — colour definitions, trial state, and RT tracking.
     *
     * Colour palettes: two full sets (default and colorblind-safe) keyed by
     * difficulty level. Increasing the palette size raises response selection
     * complexity — more alternatives means higher cognitive load per trial
     * (Hick's Law applies to the colour-naming decision).
     *
     * Trial generation: ~80% incongruent by design to maximise the number
     * of interference-producing trials per session.
     *
     * RT tracking: separate arrays for congruent vs incongruent trials
     * enable computation of the interference score, the primary clinical
     * output of the Stroop paradigm.
     */
    constructor(app) {
        this.app = app;

        // Colour palettes keyed by difficulty level (4 / 6 / 8 colours).
        // Each entry has a display name (the word shown) and a hex value (the ink).
        this.DEFAULT_COLORS = {
            1: [
                { name: 'Red', hex: '#ff0000' },
                { name: 'Blue', hex: '#0000ff' },
                { name: 'Green', hex: '#00ff00' },
                { name: 'Yellow', hex: '#ffff00' }
            ],
            2: [
                { name: 'Red', hex: '#ff0000' },
                { name: 'Blue', hex: '#0000ff' },
                { name: 'Green', hex: '#00ff00' },
                { name: 'Yellow', hex: '#ffff00' },
                { name: 'Purple', hex: '#9b59b6' },
                { name: 'Orange', hex: '#ff8000' }
            ],
            3: [
                { name: 'Red', hex: '#ff0000' },
                { name: 'Blue', hex: '#0000ff' },
                { name: 'Green', hex: '#00ff00' },
                { name: 'Yellow', hex: '#ffff00' },
                { name: 'Purple', hex: '#9b59b6' },
                { name: 'Orange', hex: '#ff8000' },
                { name: 'Pink', hex: '#fd79a8' },
                { name: 'Cyan', hex: '#00cec9' }
            ]
        };

        // Colorblind-safe palette (Wong 2011 / IBM Design) — maximally
        // distinguishable for deuteranopia, protanopia, and tritanopia.
        this.COLORBLIND_COLORS = {
            1: [
                { name: 'Red', hex: '#D55E00' },
                { name: 'Blue', hex: '#0072B2' },
                { name: 'Green', hex: '#009E73' },
                { name: 'Yellow', hex: '#F0E442' }
            ],
            2: [
                { name: 'Red', hex: '#D55E00' },
                { name: 'Blue', hex: '#0072B2' },
                { name: 'Green', hex: '#009E73' },
                { name: 'Yellow', hex: '#F0E442' },
                { name: 'Purple', hex: '#CC79A7' },
                { name: 'Orange', hex: '#E69F00' }
            ],
            3: [
                { name: 'Red', hex: '#D55E00' },
                { name: 'Blue', hex: '#0072B2' },
                { name: 'Green', hex: '#009E73' },
                { name: 'Yellow', hex: '#F0E442' },
                { name: 'Purple', hex: '#CC79A7' },
                { name: 'Orange', hex: '#E69F00' },
                { name: 'Pink', hex: '#882255' },
                { name: 'Cyan', hex: '#56B4E9' }
            ]
        };

        // Per-user colorblind setting; falls back to global localStorage for guest mode
        const activeUser = this.app.users ? this.app.users.getActiveUser() : null;
        this.colorblindMode = activeUser ? !!activeUser.colorblind : localStorage.getItem('doddgames_colorblind') === 'true';

        // Shorter delay = more time pressure at harder levels (ms)
        this.FEEDBACK_DELAYS = { 1: 600, 2: 400, 3: 250 };

        this.difficulty = 2;
        this.correctCount = 0;
        this.wrongCount = 0;
        this.streak = 0;
        this.bestStreak = 0;
        this.currentAnswer = '';
        this.locked = false;

        // RT tracking — separate arrays for congruent vs incongruent trials
        // so we can compute the interference score (incongruent − congruent).
        this.trialStartTime = 0;     // performance.now() at stimulus onset
        this.reactionTimes = [];     // all RTs (for overall average)
        this.congruentRTs = [];      // RTs when word == ink colour
        this.incongruentRTs = [];    // RTs when word != ink colour
        this.isCongruent = false;

        this._keyHandler = this._keyHandler.bind(this);
    }

    // ── Difficulty selection ────────────────────────────────────────────────────
    // Switches the active colour palette size and feedback delay. More colours
    // increase response selection difficulty; shorter feedback delays increase
    // time pressure. Rebuilds buttons and immediately starts a new trial.
    setDifficulty(level) {
        this.difficulty = level;
        document.querySelectorAll('#stroop-difficulty .diff-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.level) === level);
        });
        const labels = { 1: '(Easy \u2014 4 colors)', 2: '(Medium \u2014 6 colors)', 3: '(Hard \u2014 8 colors)' };
        document.getElementById('stroop-diff-label').textContent = labels[level] || '';
        this._buildButtons();
        this._nextRound();
    }

    // ── Session initialisation ─────────────────────────────────────────────────
    // Resets all trial counters, clears RT arrays, rebuilds the button grid
    // for the current difficulty, registers the keyboard handler, and
    // presents the first stimulus.
    init() {
        this.correctCount = 0;
        this.wrongCount = 0;
        this.streak = 0;
        this.bestStreak = 0;
        this.locked = false;
        this.reactionTimes = [];
        this.congruentRTs = [];
        this.incongruentRTs = [];

        document.getElementById('stroop-correct').textContent = '0';
        document.getElementById('stroop-wrong').textContent = '0';
        document.getElementById('stroop-streak').textContent = '0';
        document.getElementById('stroop-accuracy').textContent = '--%';
        document.getElementById('stroop-feedback').textContent = '';

        const labels = { 1: '(Easy \u2014 4 colors)', 2: '(Medium \u2014 6 colors)', 3: '(Hard \u2014 8 colors)' };
        document.getElementById('stroop-diff-label').textContent = labels[this.difficulty] || '';
        document.getElementById('cb-toggle').classList.toggle('active', this.colorblindMode);

        this._buildButtons();
        this._nextRound();
        document.addEventListener('keydown', this._keyHandler);
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────────
    // Removes the keydown listener. No other persistent resources to release.
    cleanup() {
        document.removeEventListener('keydown', this._keyHandler);
    }

    // ── Colorblind mode toggle ──────────────────────────────────────────────────
    // Swaps between the standard palette and the Wong/IBM colorblind-safe
    // palette. Persisted in localStorage so it survives page reloads.
    // Important for assessment validity: participants with colour vision
    // deficiency would otherwise conflate perceptual difficulty with
    // cognitive interference, inflating error rates and RTs.
    toggleColorblind() {
        this.colorblindMode = !this.colorblindMode;
        // Persist per-user when a user is active, else global
        const activeUser = this.app.users ? this.app.users.getActiveUser() : null;
        if (activeUser) {
            this.app.users.updateUserSettings(activeUser.id, { colorblind: this.colorblindMode });
        } else {
            localStorage.setItem('doddgames_colorblind', this.colorblindMode);
        }
        document.getElementById('cb-toggle').classList.toggle('active', this.colorblindMode);
        this._buildButtons();
        this._nextRound();
    }

    _getColors() {
        const palette = this.colorblindMode ? this.COLORBLIND_COLORS : this.DEFAULT_COLORS;
        return palette[this.difficulty] || palette[2];
    }

    // ── Response button builder ────────────────────────────────────────────────
    // Dynamically creates one button per colour in the active palette.
    // Each button displays the colour name and a numeric keyboard shortcut
    // hint (1-based index). Laid out in a 2-column CSS grid.
    _buildButtons() {
        const container = document.getElementById('stroop-buttons');
        container.innerHTML = '';
        const colors = this._getColors();
        colors.forEach((c, i) => {
            const btn = document.createElement('button');
            btn.className = 'stroop-btn';
            btn.textContent = c.name;

            const hint = document.createElement('span');
            hint.className = 'key-hint';
            hint.textContent = i + 1;
            btn.appendChild(hint);

            btn.addEventListener('click', () => this._handleAnswer(c.name, btn));
            container.appendChild(btn);
        });

        container.style.gridTemplateColumns = 'repeat(2, 1fr)';
    }

    // Generate a new trial. 80% of the time force an incongruent pairing
    // (word and ink colour differ) to maximise interference data. The
    // remaining 20% may be congruent (word matches ink) by chance.
    _nextRound() {
        if (this.app.gamePaused) { setTimeout(() => this._nextRound(), 100); return; }
        const colors = this._getColors();
        const wordIdx = Math.floor(Math.random() * colors.length);
        let inkIdx = Math.floor(Math.random() * colors.length);
        if (Math.random() < 0.8) {
            // Re-roll ink until it differs from the word → incongruent trial
            while (inkIdx === wordIdx) {
                inkIdx = Math.floor(Math.random() * colors.length);
            }
        }

        const wordEl = document.getElementById('stroop-word');
        wordEl.textContent = colors[wordIdx].name;
        wordEl.style.color = colors[inkIdx].hex;
        this.currentAnswer = colors[inkIdx].name;
        this.isCongruent = (wordIdx === inkIdx);
        this.locked = false;

        // Start RT clock
        this.trialStartTime = performance.now();
    }

    // Score a response: measure RT, bin by congruency, update counters.
    // The locked flag prevents double-responses during the feedback delay.
    _handleAnswer(chosen, btn) {
        if (this.locked) return;
        this.locked = true;

        // Measure RT from stimulus onset to button press
        const rt = performance.now() - this.trialStartTime;
        this.reactionTimes.push(rt);
        if (this.isCongruent) {
            this.congruentRTs.push(rt);
        } else {
            this.incongruentRTs.push(rt);
        }

        const feedbackEl = document.getElementById('stroop-feedback');

        if (chosen === this.currentAnswer) {
            this.correctCount++;
            this.streak++;
            if (this.streak > this.bestStreak) this.bestStreak = this.streak;
            btn.classList.add('flash-correct');
            feedbackEl.textContent = 'Correct!';
            feedbackEl.style.color = '#2ecc71';
            this.app.audio.playCorrect();
            this.app.audio.haptic(25);
        } else {
            this.wrongCount++;
            this.streak = 0;
            btn.classList.add('flash-wrong');
            feedbackEl.textContent = `Wrong \u2014 it was ${this.currentAnswer}`;
            feedbackEl.style.color = '#e74c3c';
            this.app.audio.playWrong();
            this.app.audio.haptic([50, 30, 50]);
        }

        document.getElementById('stroop-correct').textContent = this.correctCount;
        document.getElementById('stroop-wrong').textContent = this.wrongCount;
        document.getElementById('stroop-streak').textContent = this.streak;
        const total = this.correctCount + this.wrongCount;
        document.getElementById('stroop-accuracy').textContent =
            total > 0 ? Math.round((this.correctCount / total) * 100) + '%' : '--%';

        const delay = this.FEEDBACK_DELAYS[this.difficulty] || 400;
        setTimeout(() => {
            btn.classList.remove('flash-correct', 'flash-wrong');
            feedbackEl.textContent = '';
            this._nextRound();
        }, delay);
    }

    // Keyboard shortcut: keys 1–N map to button positions.
    // Guard: only fires when Stroop is the active game and not locked.
    _keyHandler(e) {
        if (this.app.currentGame !== 'stroop' || this.locked) return;
        const colors = this._getColors();
        const num = parseInt(e.key);
        if (num >= 1 && num <= colors.length) {
            const btns = document.querySelectorAll('#stroop-buttons .stroop-btn');
            this._handleAnswer(colors[num - 1].name, btns[num - 1]);
            e.preventDefault();
        }
    }

    // ── Mean RT helper ────────────────────────────────────────────────────────
    // Returns the arithmetic mean of an RT array (ms), or 0 if empty.
    // Used to compute per-condition averages and the overall mean.
    _meanRT(arr) {
        if (arr.length === 0) return 0;
        return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    }

    // ── Results ────────────────────────────────────────────────────────────────
    // Returns the session summary in the three formats expected by the app.
    //
    // Clinical interpretation notes:
    //   - interferenceScore = incongruentRT − congruentRT: the standard
    //     clinical Stroop metric. Higher values = more difficulty suppressing
    //     automatic word reading, indicating weaker inhibitory control.
    //     Typical healthy-adult interference is 50–150 ms; scores > 200 ms
    //     may warrant further neuropsychological evaluation.
    //   - accuracy: overall error rate; compare across difficulty levels.
    //   - bestStreak: sustained correct-response run; indexes sustained
    //     attention and consistency of inhibitory control.
    //   - congruentRT vs incongruentRT: the raw condition means underlying
    //     the interference score; useful for identifying whether slowness
    //     is global (both high) or interference-specific (only incongruent).
    getResults() {
        const total = this.correctCount + this.wrongCount;
        const acc = total > 0 ? Math.round((this.correctCount / total) * 100) : 0;
        const diffLabels = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

        const avgRT = this._meanRT(this.reactionTimes);
        const congruentRT = this._meanRT(this.congruentRTs);
        const incongruentRT = this._meanRT(this.incongruentRTs);
        const interferenceScore = incongruentRT > 0 && congruentRT > 0 ? incongruentRT - congruentRT : 0;

        const data = {
            correct: this.correctCount,
            wrong: this.wrongCount,
            accuracy: acc,
            bestStreak: this.bestStreak,
            difficulty: this.difficulty,
            avgRT,
            congruentRT,
            incongruentRT,
            interferenceScore
        };
        const displayText = `${this.correctCount} correct | ${acc}% acc | Streak: ${this.bestStreak} | ${diffLabels[this.difficulty]} | RT: ${avgRT}ms`;
        const summary = `Difficulty: ${diffLabels[this.difficulty]}<br>Correct: ${this.correctCount}<br>Wrong: ${this.wrongCount}<br>Accuracy: ${acc}%<br>Best streak: ${this.bestStreak}<br>Avg RT: ${avgRT}ms<br>Congruent RT: ${congruentRT}ms<br>Incongruent RT: ${incongruentRT}ms<br>Interference: ${interferenceScore}ms`;
        return { data, displayText, summary };
    }
}
