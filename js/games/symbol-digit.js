/* ══════════════════════════════════════════════════════════
   SYMBOL DIGIT MODALITIES TEST (SDMT) — Processing speed
   Match symbols to digits using a reference key.

   Clinical background:
   - The SDMT (Aaron Smith, 1968) is one of the most widely used
     neuropsychological measures of information processing speed.
   - It is considered among the most sensitive single tests for
     detecting cognitive impairment across a broad range of conditions:
     normal aging, traumatic brain injury (TBI), multiple sclerosis (MS),
     ADHD, and early neurodegenerative disease.
   - Processing speed is the first cognitive domain to show robust
     age-related decline, typically beginning in the mid-20s. SDMT
     scores correlate strongly with age (r ~ -0.5 in population norms),
     making it an excellent normative benchmark.
   - In MS research, SDMT is the recommended screening measure for
     cognitive monitoring (BICAMS consensus, 2012).
   - Unlike many cognitive tests, SDMT has minimal ceiling effects
     in healthy young adults, preserving sensitivity across the full
     ability range.

   Standard SDMT paradigm:
   - 9 symbol-digit pairs are assigned at the start of each session.
   - The mapping is randomized (Fisher-Yates shuffle) so users cannot
     rely on prior session memory.
   - A reference key showing all 9 symbol→digit pairs is displayed
     persistently at the top of the screen throughout the task.
   - One symbol appears at a time; the user must identify and enter
     the corresponding digit as quickly and accurately as possible.

   Input methods:
   - Keyboard: pressing digit keys 1–9 registers an answer immediately.
   - Click: on-screen digit buttons (1–9) for touch/mouse input.
   - Both methods are handled; a 200 ms lock prevents double-input.

   Session structure:
   - Rounds are 90 seconds each (matching the standard clinical SDMT
     administration duration); a new round begins automatically
     after a 1.5-second inter-round pause.
   - Multiple rounds can occur within the 5-minute session timer
     managed by the parent app.
   - The symbol mapping stays fixed across rounds within a session,
     matching the paper SDMT administration format. This allows
     within-session learning to emerge as a secondary observation.

   Clinical relevance:
   - The SDMT is among the most sensitive measures of information
     processing speed; performance declines steeply and consistently
     with age, making it a useful normative benchmark.
   - Also sensitive to MS-related cognitive slowing and TBI.
   - Typical healthy adult scores: ~50-70 correct in 90 seconds;
     scores below 40 warrant clinical follow-up.
   ══════════════════════════════════════════════════════════ */
export class SymbolDigitGame {
    constructor(app) {
        this.app = app;

        // 9 symbols drawn from Unicode geometric/dingbat characters.
        // Each symbol is visually distinct to minimize perceptual confusion.
        // The standard paper SDMT uses hand-drawn abstract symbols; these
        // Unicode equivalents approximate that visual complexity while
        // ensuring consistent cross-platform rendering.
        this.SYMBOLS = ['◯', '△', '◇', '☆', '✚', '⬡', '⟡', '≋', '⌘'];
        this.DIGIT_MAP = {}; // symbol → digit (1-9), randomized per session in _shuffleMapping()

        // 90-second round duration matches the standard clinical SDMT protocol.
        // The paper version uses a single 90s trial; here we allow multiple rounds
        // within the session to capture practice effects and fatigue curves.
        this.roundDuration = 90; // seconds per round
        this.roundTimer = null;  // setInterval ID for the countdown tick
        this.roundTimeLeft = 0;  // remaining seconds in current round
        this.currentSymbol = ''; // the symbol currently displayed as stimulus

        // --- Scoring state ---
        this.correctCount = 0;   // correct responses in the current round
        this.errorCount = 0;     // errors in the current round
        this.totalCorrect = 0;   // cumulative correct across all rounds (primary SDMT score)
        this.totalErrors = 0;    // cumulative errors across all rounds
        this.roundsCompleted = 0;
        this.bestRoundScore = 0; // highest single-round correct count (peak performance)
        this.locked = false;     // 200ms input lock prevents double-registration between symbols

        this._handleKey = this._handleKey.bind(this);
        this._handleDigitClick = this._handleDigitClick.bind(this);
    }

    init() {
        this.totalCorrect = 0;
        this.totalErrors = 0;
        this.roundsCompleted = 0;
        this.bestRoundScore = 0;

        // Randomize the symbol→digit mapping for this session.
        // The same mapping persists for all rounds within the session.
        this._shuffleMapping();

        document.getElementById('sdmt-correct').textContent = '0';
        document.getElementById('sdmt-errors').textContent = '0';
        document.getElementById('sdmt-round').textContent = '1';
        document.getElementById('sdmt-best').textContent = '--';
        document.getElementById('sdmt-round-timer').textContent = '90';

        // Render the persistent reference key at the top of the screen
        this._renderKey();
        // Build the 9 clickable digit buttons (touch/mouse input)
        this._renderDigitButtons();
        this._startRound();

        // Keyboard listener registered on document to capture 1–9 at any time
        document.addEventListener('keydown', this._handleKey);
    }

    cleanup() {
        document.removeEventListener('keydown', this._handleKey);
        // Clear the round timer to prevent callbacks firing after game ends
        clearInterval(this.roundTimer);
        this.roundTimer = null;
    }

    _shuffleMapping() {
        // Assign each symbol a unique digit 1–9 via Fisher-Yates shuffle.
        // This ensures no two symbols share a digit and the mapping varies
        // each session, preventing learned associations across sessions.
        const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        for (let i = digits.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [digits[i], digits[j]] = [digits[j], digits[i]];
        }
        this.DIGIT_MAP = {};
        this.SYMBOLS.forEach((sym, idx) => {
            this.DIGIT_MAP[sym] = digits[idx];
        });
    }

    // Renders the persistent symbol-digit reference key at the top of the screen.
    // In the standard SDMT, this key is always visible — the test measures
    // visual scanning and processing speed, not paired-associate memory.
    // Frequent key consultation is expected and does not indicate impairment.
    _renderKey() {
        // Build the reference key: a row of symbol-over-digit pairs that
        // remains visible throughout the task. Users may glance at it freely —
        // the test measures processing speed, not memorization.
        const keyEl = document.getElementById('sdmt-key');
        keyEl.innerHTML = '';

        this.SYMBOLS.forEach(sym => {
            const pair = document.createElement('div');
            pair.className = 'sdmt-key-pair';

            const symEl = document.createElement('div');
            symEl.className = 'sdmt-key-symbol';
            symEl.textContent = sym;

            const digitEl = document.createElement('div');
            digitEl.className = 'sdmt-key-digit';
            digitEl.textContent = this.DIGIT_MAP[sym];

            pair.appendChild(symEl);
            pair.appendChild(digitEl);
            keyEl.appendChild(pair);
        });
    }

    _renderDigitButtons() {
        // Create one button per digit (1–9) for pointer/touch input.
        // Keyboard input is handled separately via _handleKey.
        const container = document.getElementById('sdmt-digits');
        container.innerHTML = '';

        for (let d = 1; d <= 9; d++) {
            const btn = document.createElement('button');
            btn.className = 'sdmt-digit-btn';
            btn.textContent = d;
            btn.dataset.digit = d;
            btn.addEventListener('click', this._handleDigitClick);
            container.appendChild(btn);
        }
    }

    _startRound() {
        // Reset per-round counters and restart the 90-second countdown.
        this.correctCount = 0;
        this.errorCount = 0;
        this.roundTimeLeft = this.roundDuration;
        this.locked = false;

        document.getElementById('sdmt-correct').textContent = '0';
        document.getElementById('sdmt-errors').textContent = '0';
        document.getElementById('sdmt-round-timer').textContent = this.roundTimeLeft;

        this._nextSymbol();

        // 1-second interval tick; skips ticks while the session is paused
        clearInterval(this.roundTimer);
        this.roundTimer = setInterval(() => {
            if (this.app.gamePaused) return;

            this.roundTimeLeft--;
            document.getElementById('sdmt-round-timer').textContent = this.roundTimeLeft;

            // Turn the timer red in the final 10 seconds as a visual warning
            if (this.roundTimeLeft <= 10) {
                document.getElementById('sdmt-round-timer').style.color = '#e74c3c';
            }

            if (this.roundTimeLeft <= 0) {
                this._endRound();
            }
        }, 1000);
    }

    // Selects and displays the next random symbol stimulus.
    // Symbol selection is uniform random with replacement — the same symbol
    // can appear consecutively. This matches standard SDMT administration
    // where symbol order is pseudo-random and repetition is permitted.
    _nextSymbol() {
        // Pick a random symbol from the 9-symbol pool and display it as the stimulus.
        // The pop-in animation is retriggered by forcing a reflow (offsetWidth read)
        // after resetting the animation property.
        const idx = Math.floor(Math.random() * this.SYMBOLS.length);
        this.currentSymbol = this.SYMBOLS[idx];
        this.locked = false;

        const display = document.getElementById('sdmt-stimulus');
        display.textContent = this.currentSymbol;
        display.style.animation = 'none';
        void display.offsetWidth; // force reflow to restart CSS animation
        display.style.animation = 'countPop 0.3s ease-out';
    }

    // Keyboard handler: accepts digit keys 1–9
    _handleKey(e) {
        if (this.locked) return;
        const digit = parseInt(e.key);
        if (digit >= 1 && digit <= 9) {
            this._checkAnswer(digit);
        }
    }

    // Click handler: reads digit from button's data-digit attribute
    _handleDigitClick(e) {
        if (this.locked) return;
        const digit = parseInt(e.target.dataset.digit);
        if (digit >= 1 && digit <= 9) {
            this._checkAnswer(digit);
        }
    }

    // Validates the user's digit response against the current symbol's mapping.
    // Correct/error feedback is immediate (audio + haptic). The 200ms inter-trial
    // lock paces the task while keeping throughput high — at maximum performance,
    // ~5 responses per second is the theoretical ceiling.
    _checkAnswer(digit) {
        // Lock immediately to prevent a second input while waiting for the
        // next symbol (200 ms delay keeps the pace brisk without feeling abrupt).
        this.locked = true;
        const correct = this.DIGIT_MAP[this.currentSymbol];

        if (digit === correct) {
            this.correctCount++;
            this.totalCorrect++;
            document.getElementById('sdmt-correct').textContent = this.correctCount;
            this.app.audio.playCorrect();
            this.app.audio.haptic(15);
        } else {
            this.errorCount++;
            this.totalErrors++;
            document.getElementById('sdmt-errors').textContent = this.errorCount;
            this.app.audio.playWrong();
            this.app.audio.haptic([50, 30, 50]);
        }

        // Short pause before advancing to the next symbol
        setTimeout(() => this._nextSymbol(), 200);
    }

    // Called when the 90-second round timer expires. Updates cumulative stats,
    // tracks best-round score (useful for distinguishing peak ability from
    // sustained performance — a gap may indicate fatigue or attention drift).
    _endRound() {
        clearInterval(this.roundTimer);
        this.roundTimer = null;

        this.roundsCompleted++;
        if (this.correctCount > this.bestRoundScore) {
            this.bestRoundScore = this.correctCount;
        }

        document.getElementById('sdmt-best').textContent = this.bestRoundScore;
        document.getElementById('sdmt-round').textContent = this.roundsCompleted + 1;
        document.getElementById('sdmt-round-timer').style.color = '#00d4ff';

        // Display round score in the stimulus area, then start the next round
        this.locked = true;
        const feedback = document.getElementById('sdmt-stimulus');
        feedback.textContent = `${this.correctCount} correct!`;

        setTimeout(() => {
            this._startRound();
        }, 1500);
    }

    /* Returns scored results conforming to the standard game interface.
       Key clinical outputs:
       - totalCorrect: primary SDMT score (total correct across all rounds).
         This is the standard metric used in clinical norms.
       - totalErrors: error count; high errors with high correct count may
         indicate a speed-accuracy tradeoff (impulsive responding).
       - bestRoundScore: peak single-round performance. Comparing best vs.
         average round scores reveals fatigue or practice effects.
       - roundsCompleted: number of 90s rounds completed in the session. */
    getResults() {
        const data = {
            totalCorrect: this.totalCorrect,
            totalErrors: this.totalErrors,
            roundsCompleted: this.roundsCompleted,
            bestRoundScore: this.bestRoundScore,
        };
        const displayText = `${this.totalCorrect} correct | ${this.totalErrors} errors | Best round: ${this.bestRoundScore}`;
        const summary = `Total correct: ${this.totalCorrect}<br>Total errors: ${this.totalErrors}<br>Rounds completed: ${this.roundsCompleted}<br>Best round score: ${this.bestRoundScore}<br><br><em>Highly sensitive to processing speed; robust age-related decline expected</em>`;
        return { data, displayText, summary };
    }
}
