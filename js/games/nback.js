/* ══════════════════════════════════════════════════════════
   N-BACK — Working-memory updating (spatial)
   ══════════════════════════════════════════════════════════
   Clinical background:
   - The N-back taxes working-memory UPDATING (continuous monitoring
     and refreshing of a buffer), a distinct construct from the storage
     SPAN measured by Digit Span. A position lights up in a 3×3 grid each
     trial; the player responds when it matches the position N steps back.
   - Adaptive staircase: the level N rises after a high-accuracy block and
     falls after a poor one, converging on the player's working-memory
     capacity. The headline metric is the hardest level sustained (maxLevel),
     analogous to Digit Span's max span.
   - Signal-detection scoring (hits vs. false alarms → d′) separates genuine
     discrimination from response bias; the log-linear correction avoids
     infinite d′ at ceiling/floor rates.
   - The first N trials of each block are warm-up (no match is possible yet)
     and are excluded from scoring.
   ══════════════════════════════════════════════════════════ */
export class NBackGame {
    constructor(app) {
        this.app = app;

        // Timing (ms). SOA ≈ STIM + ISI ≈ 2.5s is the conventional n-back pace:
        // long enough to rehearse, short enough to load updating.
        this.STIM_DURATION = 700;
        this.ISI = 1800;

        // Block = N warm-up trials + a fixed number of scored trials.
        this.BLOCK_SCORED = 15;
        // Probability that an eligible trial is a target (position == N back).
        this.MATCH_RATE = 0.3;
        // Block accuracy thresholds driving the adaptive staircase.
        this.LEVEL_UP = 0.8;
        this.LEVEL_DOWN = 0.5;

        this._reset();

        this._keyHandler = this._keyHandler.bind(this);
        this._respond = this._respond.bind(this);
        this._tapRespond = this._tapRespond.bind(this);
    }

    _reset() {
        this.N = 1;                  // current level
        this.maxLevel = 0;           // hardest level passed (>= LEVEL_UP accuracy)
        this.phase = 'idle';         // idle | stimulus | isi | done
        this.sequence = [];          // positions (0-8) for the active block
        this.blockIdx = 0;           // index within the active block
        this.isTarget = false;       // is the current trial a match?
        this.eligible = false;       // is the current trial scored (not warm-up)?
        this.responded = false;      // single-response latch per trial
        this.stimulusOnset = 0;
        this.phaseTimer = null;

        // Global (whole-session) signal-detection counters.
        this.hits = 0;
        this.misses = 0;
        this.falseAlarms = 0;
        this.correctRejections = 0;
        this.reactionTimes = [];

        // Per-block counters (reset each block) for the staircase decision.
        this._resetBlockCounts();
    }

    _resetBlockCounts() {
        this.bHits = 0;
        this.bMiss = 0;
        this.bFA = 0;
        this.bCR = 0;
    }

    init() {
        this._reset();

        document.getElementById('nback-level').textContent = '1';
        document.getElementById('nback-hits').textContent = '0';
        document.getElementById('nback-false-alarms').textContent = '0';
        document.getElementById('nback-accuracy').textContent = '--';

        document.addEventListener('keydown', this._keyHandler);
        document.getElementById('nback-area').addEventListener('click', this._respond);
        document.getElementById('nback-match-btn').addEventListener('click', this._tapRespond);

        this._startBlock();
        setTimeout(() => this._nextTrial(), 600);
    }

    cleanup() {
        document.removeEventListener('keydown', this._keyHandler);
        document.getElementById('nback-area').removeEventListener('click', this._respond);
        document.getElementById('nback-match-btn').removeEventListener('click', this._tapRespond);
        clearTimeout(this.phaseTimer);
        this.phase = 'done';
    }

    _tapRespond(e) {
        e.stopPropagation();
        this._respond();
    }

    /* Build one block's position sequence for the current level N.
       The first N positions are random warm-up; each subsequent trial is a
       target (repeat of N-back) with probability MATCH_RATE, otherwise a
       forced non-match (a different cell), guaranteeing clean lure trials. */
    _startBlock() {
        this.sequence = [];
        const total = this.N + this.BLOCK_SCORED;
        for (let i = 0; i < total; i++) {
            if (i < this.N) {
                this.sequence.push(Math.floor(Math.random() * 9));
            } else if (Math.random() < this.MATCH_RATE) {
                this.sequence.push(this.sequence[i - this.N]);            // target
            } else {
                let p = Math.floor(Math.random() * 9);
                if (p === this.sequence[i - this.N]) p = (p + 1) % 9;     // force non-match
                this.sequence.push(p);
            }
        }
        this.blockIdx = 0;
        this._resetBlockCounts();
        document.getElementById('nback-level').textContent = String(this.N);
        const inline = document.getElementById('nback-level-inline');
        if (inline) inline.textContent = String(this.N);
    }

    /* Apply the adaptive staircase from the block just completed, then record
       the hardest level handled. Level rises on strong accuracy, falls on weak. */
    _endBlock() {
        const scored = this.bHits + this.bMiss + this.bFA + this.bCR;
        if (scored === 0) return;
        const acc = (this.bHits + this.bCR) / scored;
        if (acc >= this.LEVEL_UP) {
            this.maxLevel = Math.max(this.maxLevel, this.N);
            this.N++;
        } else if (acc <= this.LEVEL_DOWN && this.N > 1) {
            this.N--;
        }
    }

    _nextTrial() {
        if (this.phase === 'done') return;
        if (this.app.gamePaused) { this.phaseTimer = setTimeout(() => this._nextTrial(), 100); return; }

        if (this.blockIdx >= this.sequence.length) {
            this._endBlock();
            this._startBlock();
        }

        const idx = this.blockIdx;
        const pos = this.sequence[idx];
        this.eligible = idx >= this.N;
        this.isTarget = this.eligible && pos === this.sequence[idx - this.N];
        this.responded = false;
        this.stimulusOnset = performance.now();
        this.phase = 'stimulus';

        const cell = document.getElementById('nback-cell-' + pos);
        if (cell) cell.classList.add('lit');

        this.phaseTimer = setTimeout(() => this._endStimulus(pos), this.STIM_DURATION);
    }

    _endStimulus(pos) {
        if (this.phase === 'done') return;
        if (this.app.gamePaused) { this.phaseTimer = setTimeout(() => this._endStimulus(pos), 100); return; }

        const cell = document.getElementById('nback-cell-' + pos);
        if (cell) cell.classList.remove('lit');

        // Response window stays open through the ISI.
        this.phase = 'isi';
        this.phaseTimer = setTimeout(() => this._closeWindow(), this.ISI);
    }

    /* Window closed with no response: score the omission outcome, then advance. */
    _closeWindow() {
        if (this.phase === 'done') return;
        if (this.app.gamePaused) { this.phaseTimer = setTimeout(() => this._closeWindow(), 100); return; }

        if (this.eligible && !this.responded) {
            if (this.isTarget) { this.misses++; this.bMiss++; }
            else { this.correctRejections++; this.bCR++; }
            this._updateAccuracy();
        }
        this.blockIdx++;
        this._nextTrial();
    }

    /* Any response during the open window (stimulus or isi). Warm-up trials
       can't be targets, so responses there are ignored rather than penalized. */
    _respond() {
        if (this.app.gamePaused) return;
        if (this.phase !== 'stimulus' && this.phase !== 'isi') return;
        if (this.responded) return;
        this.responded = true;
        if (!this.eligible) return;

        const grid = document.getElementById('nback-grid');
        if (this.isTarget) {
            this.hits++;
            this.bHits++;
            this.reactionTimes.push(performance.now() - this.stimulusOnset);
            document.getElementById('nback-hits').textContent = this.hits;
            if (grid) grid.classList.add('feedback-hit');
            this.app.audio.playCorrect();
            this.app.audio.haptic(25);
        } else {
            this.falseAlarms++;
            this.bFA++;
            document.getElementById('nback-false-alarms').textContent = this.falseAlarms;
            if (grid) grid.classList.add('feedback-fa');
            this.app.audio.playWrong();
            this.app.audio.haptic([50, 30, 50]);
        }
        this._updateAccuracy();
        setTimeout(() => {
            if (grid) grid.classList.remove('feedback-hit', 'feedback-fa');
        }, 150);
    }

    _updateAccuracy() {
        const scored = this.hits + this.misses + this.falseAlarms + this.correctRejections;
        const acc = scored > 0 ? Math.round(((this.hits + this.correctRejections) / scored) * 100) : 0;
        document.getElementById('nback-accuracy').textContent = scored > 0 ? acc + '%' : '--';
    }

    _keyHandler(e) {
        if (this.app.currentGame !== 'nback') return;
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            this._respond();
        }
    }

    /* Inverse standard-normal CDF (Acklam's rational approximation), used to
       convert hit/false-alarm rates into z-scores for d′. Accurate to ~1e-9. */
    _invNorm(p) {
        const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
            1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
        const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
            6.680131188771972e+01, -1.328068155288572e+01];
        const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
            -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
        const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
            3.754408661907416e+00];
        const plow = 0.02425, phigh = 1 - plow;
        let q, r;
        if (p < plow) {
            q = Math.sqrt(-2 * Math.log(p));
            return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
        } else if (p <= phigh) {
            q = p - 0.5; r = q * q;
            return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
                (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
        }
        q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }

    getResults() {
        const targets = this.hits + this.misses;
        const nonTargets = this.falseAlarms + this.correctRejections;
        const scored = targets + nonTargets;
        const accuracy = scored > 0 ? Math.round(((this.hits + this.correctRejections) / scored) * 100) : 0;

        // Log-linear correction keeps d′ finite at perfect/zero rates.
        const hitRate = (this.hits + 0.5) / (targets + 1);
        const faRate = (this.falseAlarms + 0.5) / (nonTargets + 1);
        const dPrime = Math.round((this._invNorm(hitRate) - this._invNorm(faRate)) * 100) / 100;

        const avgRT = this.reactionTimes.length > 0
            ? Math.round(this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length)
            : 0;

        const data = {
            maxLevel: this.maxLevel,
            currentLevel: this.N,
            hits: this.hits,
            misses: this.misses,
            falseAlarms: this.falseAlarms,
            correctRejections: this.correctRejections,
            accuracy,
            dPrime,
            avgRT,
            totalTrials: scored,
        };

        const displayText = `Level ${this.maxLevel}-back | d′ ${dPrime} | ${accuracy}% | Hits: ${this.hits}/${targets} | FA: ${this.falseAlarms}`;
        const summary = `Max Level: ${this.maxLevel}-back<br>d′ (sensitivity): ${dPrime}<br>Accuracy: ${accuracy}%<br>Hits: ${this.hits} / ${targets}<br>False Alarms: ${this.falseAlarms}<br>Misses: ${this.misses}<br>Avg RT: ${avgRT}ms<br>Trials: ${scored}`;

        return { data, displayText, summary };
    }
}
