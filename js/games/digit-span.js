/* ══════════════════════════════════════════════════════════
   DIGIT SPAN — Memory: short-term & working memory capacity
   Forward and reverse digit recall with adaptive span length.

   PARADIGM OVERVIEW
   ─────────────────
   Classic digit span task used in WAIS, WMS, and most
   neuropsychological batteries. Measures phonological loop
   capacity (forward) and central executive involvement (reverse).

   PHASE STATE MACHINE
   ───────────────────
   idle → forward (span 3, increasing) → reverse (span 2, increasing) → done

   FORWARD PHASE
   ─────────────
   Digits 1–9 are presented one at a time (1 s each, 500 ms gap).
   The participant enters them in the same order. Two trials per
   span length; advance if at least 1 is correct. Stop after both
   trials at a given length are failed.

   REVERSE PHASE
   ─────────────
   Same presentation, but participant enters digits in reverse
   order. Starts at span 2. Same 2-trial/advance/stop rules.

   SCORING
   ───────
   maxSpan        — highest span achieved across both phases
   forwardSpan    — highest span achieved in forward phase
   reverseSpan    — highest span achieved in reverse phase
   totalCorrect   — total correct trials
   totalTrials    — total trials attempted
   ══════════════════════════════════════════════════════════ */
export class DigitSpanGame {
    constructor(app) {
        this.app = app;

        // Timing constants (ms)
        this.DIGIT_DISPLAY_TIME = 1000;
        this.DIGIT_GAP_TIME = 500;

        // Starting span lengths
        this.FORWARD_START = 3;
        this.REVERSE_START = 2;

        // State
        this.phase = 'idle';          // 'idle' | 'forward' | 'reverse' | 'done'
        this.currentSpan = 0;
        this.trialInSpan = 0;         // 0 or 1 (two trials per span)
        this.failuresAtSpan = 0;
        this.sequence = [];
        this.playerInput = [];
        this.presenting = false;

        // Results tracking
        this.forwardSpan = 0;
        this.reverseSpan = 0;
        this.totalCorrect = 0;
        this.totalTrials = 0;

        // Timeout IDs for cleanup
        this._timeouts = [];

        // Bound handlers
        this._keyHandler = (e) => this._handleKey(e);
    }

    init() {
        this.phase = 'idle';
        this.forwardSpan = 0;
        this.reverseSpan = 0;
        this.totalCorrect = 0;
        this.totalTrials = 0;
        this.playerInput = [];
        this.sequence = [];
        this.presenting = false;
        this._timeouts = [];

        // DOM references
        this._digitDisplay = document.getElementById('digit-span-display');
        this._inputDisplay = document.getElementById('digit-span-input');
        this._phaseLabel = document.getElementById('digit-span-phase');
        this._spanStat = document.getElementById('digit-span-stat');
        this._trialStat = document.getElementById('digit-span-trial');
        this._correctStat = document.getElementById('digit-span-correct');
        this._feedback = document.getElementById('digit-span-feedback');
        this._numpad = document.getElementById('digit-span-numpad');
        this._submitBtn = document.getElementById('digit-span-submit');
        this._backspaceBtn = document.getElementById('digit-span-backspace');
        this._instructionEl = document.getElementById('digit-span-instruction');

        // Reset UI
        this._digitDisplay.textContent = '';
        this._inputDisplay.textContent = '';
        this._feedback.textContent = '';
        this._feedback.className = 'digit-span-feedback';
        this._updateStats();
        this._setNumpadEnabled(false);

        // Bind numpad buttons
        this._numpad.querySelectorAll('.digit-btn').forEach(btn => {
            btn.addEventListener('click', this._numpadClick = (e) => {
                const digit = e.currentTarget.dataset.digit;
                if (digit) this._addDigit(parseInt(digit, 10));
            });
        });
        this._submitBtn.addEventListener('click', this._submitClick = () => this._submitResponse());
        this._backspaceBtn.addEventListener('click', this._backspaceClick = () => this._removeDigit());

        // Keyboard input
        document.addEventListener('keydown', this._keyHandler);

        // Show instruction and start after brief delay
        this._showInstruction('forward');
        this._addTimeout(() => this._startPhase('forward'), 2000);
    }

    cleanup() {
        // Clear all pending timeouts
        this._timeouts.forEach(id => clearTimeout(id));
        this._timeouts = [];

        // Remove event listeners
        document.removeEventListener('keydown', this._keyHandler);
        if (this._numpad) {
            this._numpad.querySelectorAll('.digit-btn').forEach(btn => {
                btn.removeEventListener('click', this._numpadClick);
            });
        }
        if (this._submitBtn) this._submitBtn.removeEventListener('click', this._submitClick);
        if (this._backspaceBtn) this._backspaceBtn.removeEventListener('click', this._backspaceClick);

        this.phase = 'idle';
        this.presenting = false;
    }

    getResults() {
        if (this.totalTrials === 0) return null;

        const maxSpan = Math.max(this.forwardSpan, this.reverseSpan);
        const data = {
            maxSpan,
            forwardSpan: this.forwardSpan,
            reverseSpan: this.reverseSpan,
            totalCorrect: this.totalCorrect,
            totalTrials: this.totalTrials,
        };

        const displayText = `Fwd: ${this.forwardSpan} | Rev: ${this.reverseSpan}`;

        const accuracy = this.totalTrials > 0
            ? Math.round((this.totalCorrect / this.totalTrials) * 100)
            : 0;

        const summary = `
            <h3>Digit Span Results</h3>
            <div class="results-grid">
                <div class="result-item">
                    <div class="result-label">Max Span</div>
                    <div class="result-value">${maxSpan}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">Forward Span</div>
                    <div class="result-value">${this.forwardSpan}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">Reverse Span</div>
                    <div class="result-value">${this.reverseSpan}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">Accuracy</div>
                    <div class="result-value">${accuracy}%</div>
                </div>
                <div class="result-item">
                    <div class="result-label">Correct Trials</div>
                    <div class="result-value">${this.totalCorrect} / ${this.totalTrials}</div>
                </div>
            </div>
            <p class="result-note">
                ${this.reverseSpan >= this.forwardSpan - 1
                    ? 'Reverse span within normal range of forward span — working memory intact.'
                    : 'Reverse span notably lower than forward — possible working memory difficulty.'}
            </p>`;

        return { data, displayText, summary };
    }

    // ── Phase management ──────────────────────────────────

    _startPhase(phase) {
        this.phase = phase;
        this.currentSpan = phase === 'forward' ? this.FORWARD_START : this.REVERSE_START;
        this.trialInSpan = 0;
        this.failuresAtSpan = 0;
        this._updateStats();
        this._startTrial();
    }

    _startTrial() {
        if (this.app.gamePaused) {
            // Retry after pause lifts
            this._addTimeout(() => this._startTrial(), 200);
            return;
        }

        this.playerInput = [];
        this._inputDisplay.textContent = '';
        this._feedback.textContent = '';
        this._feedback.className = 'digit-span-feedback';
        this._setNumpadEnabled(false);

        this.sequence = this._generateSequence(this.currentSpan);
        this._presentSequence();
    }

    _presentSequence() {
        this.presenting = true;
        this._digitDisplay.classList.add('presenting');
        let i = 0;

        const showNext = () => {
            if (this.phase === 'idle' || this.phase === 'done') return;
            if (this.app.gamePaused) {
                this._addTimeout(showNext, 200);
                return;
            }

            if (i < this.sequence.length) {
                this._digitDisplay.textContent = this.sequence[i];
                this._digitDisplay.classList.add('digit-flash');
                this.app.audio.playBeep();

                this._addTimeout(() => {
                    this._digitDisplay.classList.remove('digit-flash');
                    this._digitDisplay.textContent = '';
                    i++;
                    this._addTimeout(showNext, this.DIGIT_GAP_TIME);
                }, this.DIGIT_DISPLAY_TIME);
            } else {
                // Done presenting — enable input
                this.presenting = false;
                this._digitDisplay.classList.remove('presenting');
                this._digitDisplay.textContent = '?';
                this._instructionEl.textContent = this.phase === 'forward'
                    ? 'Enter the digits in the same order'
                    : 'Enter the digits in REVERSE order';
                this._setNumpadEnabled(true);
            }
        };

        showNext();
    }

    _showInstruction(phase) {
        if (phase === 'forward') {
            this._instructionEl.textContent = 'Forward Span — watch the digits, then repeat them in order';
            this._phaseLabel.textContent = 'Forward';
        } else {
            this._instructionEl.textContent = 'Reverse Span — watch the digits, then repeat them BACKWARDS';
            this._phaseLabel.textContent = 'Reverse';
        }
    }

    // ── Input handling ────────────────────────────────────

    _handleKey(e) {
        if (this.presenting || this.phase === 'idle' || this.phase === 'done') return;
        if (this.app.gamePaused) return;

        if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            this._addDigit(parseInt(e.key, 10));
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            this._removeDigit();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this._submitResponse();
        }
    }

    _addDigit(digit) {
        if (this.presenting || this.phase === 'idle' || this.phase === 'done') return;
        if (this.playerInput.length >= this.currentSpan) return;

        this.playerInput.push(digit);
        this._inputDisplay.textContent = this.playerInput.join('  ');
        this.app.audio.playLock();
    }

    _removeDigit() {
        if (this.playerInput.length === 0) return;
        this.playerInput.pop();
        this._inputDisplay.textContent = this.playerInput.join('  ') || '';
    }

    _submitResponse() {
        if (this.presenting || this.phase === 'idle' || this.phase === 'done') return;
        if (this.playerInput.length === 0) return;

        this._setNumpadEnabled(false);
        this.totalTrials++;

        const expected = this.phase === 'forward'
            ? [...this.sequence]
            : [...this.sequence].reverse();

        const correct = this.playerInput.length === expected.length &&
            this.playerInput.every((d, i) => d === expected[i]);

        if (correct) {
            this.totalCorrect++;
            this._feedback.textContent = 'Correct!';
            this._feedback.className = 'digit-span-feedback correct';
            this.app.audio.playCorrect();

            // Update best span for this phase
            if (this.phase === 'forward') {
                this.forwardSpan = Math.max(this.forwardSpan, this.currentSpan);
            } else {
                this.reverseSpan = Math.max(this.reverseSpan, this.currentSpan);
            }
        } else {
            this._feedback.textContent = `Incorrect — expected: ${expected.join('  ')}`;
            this._feedback.className = 'digit-span-feedback incorrect';
            this.app.audio.playWrong();
            this.failuresAtSpan++;
        }

        this._updateStats();

        // Advance logic: 2 trials per span, advance if at least 1 correct
        this.trialInSpan++;

        this._addTimeout(() => {
            if (this.trialInSpan < 2) {
                // Second trial at this span
                this._startTrial();
            } else if (this.failuresAtSpan >= 2) {
                // Both trials failed — end this phase
                this._endPhase();
            } else {
                // At least 1 correct — advance span
                this.currentSpan++;
                this.trialInSpan = 0;
                this.failuresAtSpan = 0;
                this._startTrial();
            }
        }, 1500);
    }

    _endPhase() {
        if (this.phase === 'forward') {
            // Transition to reverse phase
            this._digitDisplay.textContent = '';
            this._inputDisplay.textContent = '';
            this._feedback.textContent = '';
            this._feedback.className = 'digit-span-feedback';
            this._showInstruction('reverse');
            this._addTimeout(() => this._startPhase('reverse'), 2500);
        } else {
            // Both phases complete
            this.phase = 'done';
            this._digitDisplay.textContent = '';
            this._instructionEl.textContent = 'Complete!';
            this._setNumpadEnabled(false);
            this.app.stopTimer();
        }
    }

    // ── Helpers ────────────────────────────────────────────

    _generateSequence(length) {
        const seq = [];
        for (let i = 0; i < length; i++) {
            let d;
            do {
                d = Math.floor(Math.random() * 9) + 1; // 1-9
            } while (seq.length > 0 && seq[seq.length - 1] === d);
            seq.push(d);
        }
        return seq;
    }

    _setNumpadEnabled(enabled) {
        if (!this._numpad) return;
        this._numpad.querySelectorAll('button').forEach(btn => {
            btn.disabled = !enabled;
        });
        if (this._submitBtn) this._submitBtn.disabled = !enabled;
        if (this._backspaceBtn) this._backspaceBtn.disabled = !enabled;
    }

    _updateStats() {
        if (this._phaseLabel) this._phaseLabel.textContent = this.phase === 'reverse' ? 'Reverse' : 'Forward';
        if (this._spanStat) this._spanStat.textContent = this.currentSpan || '--';
        if (this._trialStat) this._trialStat.textContent = this.totalTrials;
        if (this._correctStat) this._correctStat.textContent = this.totalCorrect;
    }

    _addTimeout(fn, ms) {
        const id = setTimeout(() => {
            const idx = this._timeouts.indexOf(id);
            if (idx !== -1) this._timeouts.splice(idx, 1);
            fn();
        }, ms);
        this._timeouts.push(id);
        return id;
    }
}
