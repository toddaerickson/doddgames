/* ══════════════════════════════════════════════════════════
   CONTINUOUS PERFORMANCE TEST (AX-CPT)
   Inhibitory Control: sustained attention + context-dependent inhibition

   Each trial presents a context–probe pair (two sequential letters).
   The core rule: press SPACE when the probe is "X", UNLESS the
   context was "A" (i.e., inhibit on AX pairs).

   Four trial types with fixed proportions per 80-trial block:
     AX (20%) — context A + probe X → must INHIBIT response
     AY (20%) — context A + probe non-X → no response expected
     BX (20%) — context non-A + probe X → must RESPOND (target)
     BY (40%) — context non-A + probe non-X → no response expected

   Blocks regenerate continuously so the task never ends on its own.

   Primary signal-detection metric: d-prime = Z(hit rate) − Z(FA rate),
   where hit rate = BX hits / (BX hits + BX misses),
   FA rate = AX false alarms / (AX FA + AX correct inhibits),
   and both rates are clamped to [0.01, 0.99] before the Z-transform.
   ══════════════════════════════════════════════════════════ */
export class CPTGame {
    constructor(app) {
        this.app = app;

        this.DISPLAY_TIME = 250;    // ms letter shown
        this.ISI = 1000;            // ms between letters
        this.LETTERS = 'BCDEFGHJKLMNOPQRSTUVWYZ'.split(''); // distractor pool (A and X excluded)

        // Trial distribution per block
        this.BLOCK_TRIALS = 80;
        this.AX_RATIO = 0.20;
        this.AY_RATIO = 0.20;
        this.BX_RATIO = 0.20;
        this.BY_RATIO = 0.40;

        this.trialSequence = [];
        this.trialIdx = 0;
        this.currentLetter = '';
        this.previousLetter = '';
        this.currentTrialType = '';
        this.responded = false;     // guards against double-presses within a single stimulus
        this.stimulusStart = 0;     // timestamp (performance.now) for RT measurement

        this.axFalseAlarms = 0;    // pressed on AX probe — failed to inhibit (FA numerator)
        this.axCorrectInhibits = 0; // withheld on AX probe — successful inhibition
        this.bxHits = 0;           // pressed on BX probe — correct target detection (hit numerator)
        this.bxMisses = 0;         // failed to press on BX probe — omission error
        this.ayCorrectRejects = 0; // withheld on AY probe — correct (no target)
        this.byCorrectRejects = 0; // withheld on BY probe — correct (no target)
        this.totalFalseAlarms = 0; // pressed on any non-X letter — commission error
        this.reactionTimes = [];   // RTs for correct BX hits only
        this.totalTrials = 0;

        this.displayTimeout = null;
        this.isiTimeout = null;
        this.running = false;

        this._handleInput = this._handleInput.bind(this);
    }

    init() {
        this.axFalseAlarms = 0;
        this.axCorrectInhibits = 0;
        this.bxHits = 0;
        this.bxMisses = 0;
        this.ayCorrectRejects = 0;
        this.byCorrectRejects = 0;
        this.totalFalseAlarms = 0;
        this.reactionTimes = [];
        this.totalTrials = 0;
        this.trialIdx = 0;
        this.running = true;

        document.getElementById('cpt-hits').textContent = '0';
        document.getElementById('cpt-false-alarms').textContent = '0';
        document.getElementById('cpt-ax-inhibit').textContent = '0';
        document.getElementById('cpt-rt').textContent = '--';
        document.getElementById('cpt-letter').textContent = '';
        document.getElementById('cpt-letter').className = 'cpt-letter';

        this._generateTrialSequence();
        document.addEventListener('keydown', this._handleInput);
        document.getElementById('cpt-tap-btn').addEventListener('click', this._handleInput);
        document.getElementById('cpt-area').addEventListener('click', this._handleInput);

        // Start first trial after brief delay
        setTimeout(() => this._nextTrial(), 1000);
    }

    cleanup() {
        this.running = false;
        clearTimeout(this.displayTimeout);
        clearTimeout(this.isiTimeout);
        document.removeEventListener('keydown', this._handleInput);
        const tapBtn = document.getElementById('cpt-tap-btn');
        if (tapBtn) tapBtn.removeEventListener('click', this._handleInput);
        const area = document.getElementById('cpt-area');
        if (area) area.removeEventListener('click', this._handleInput);
    }

    _generateTrialSequence() {
        // Generate pairs: each trial is a context letter followed by a probe letter
        this.trialSequence = [];
        const n = this.BLOCK_TRIALS;

        const axCount = Math.round(n * this.AX_RATIO);
        const ayCount = Math.round(n * this.AY_RATIO);
        const bxCount = Math.round(n * this.BX_RATIO);
        // BY gets the remainder so rounding errors don't change block size
        const byCount = n - axCount - ayCount - bxCount;

        for (let i = 0; i < axCount; i++) this.trialSequence.push({ type: 'AX', context: 'A', probe: 'X' });
        for (let i = 0; i < ayCount; i++) this.trialSequence.push({ type: 'AY', context: 'A', probe: this._randomLetter() });
        for (let i = 0; i < bxCount; i++) this.trialSequence.push({ type: 'BX', context: this._randomLetter(), probe: 'X' });
        for (let i = 0; i < byCount; i++) this.trialSequence.push({ type: 'BY', context: this._randomLetter(), probe: this._randomLetter() });

        // Shuffle
        for (let i = this.trialSequence.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.trialSequence[i], this.trialSequence[j]] = [this.trialSequence[j], this.trialSequence[i]];
        }
    }

    _randomLetter() {
        return this.LETTERS[Math.floor(Math.random() * this.LETTERS.length)];
    }

    /* Trial timing sequence:
       context shown (DISPLAY_TIME) → blank (ISI) → probe shown (DISPLAY_TIME) → evaluate → blank (ISI) → next trial
       When the block is exhausted, a fresh shuffled block is generated seamlessly. */
    _nextTrial() {
        if (!this.running) return;
        if (this.app.gamePaused) { setTimeout(() => this._nextTrial(), 100); return; }

        if (this.trialIdx >= this.trialSequence.length) {
            // Block exhausted — regenerate continuously so the task never ends
            this._generateTrialSequence();
            this.trialIdx = 0;
        }

        const trial = this.trialSequence[this.trialIdx];
        this.currentTrialType = trial.type;
        this.trialIdx++;
        this.totalTrials++;

        // Show context letter first
        this._showLetter(trial.context, false);

        // After display + ISI, show probe
        this.displayTimeout = setTimeout(() => {
            this._hideLetter();
            this.isiTimeout = setTimeout(() => {
                if (!this.running) return;
                this._showLetter(trial.probe, true);

                // After display time, evaluate
                this.displayTimeout = setTimeout(() => {
                    this._hideLetter();
                    this._evaluateTrial();

                    // ISI before next trial
                    this.isiTimeout = setTimeout(() => {
                        if (this.running) this._nextTrial();
                    }, this.ISI);
                }, this.DISPLAY_TIME);
            }, this.ISI);
        }, this.DISPLAY_TIME);
    }

    _showLetter(letter, isProbe) {
        this.currentLetter = letter;
        this.responded = false;
        this.stimulusStart = performance.now();

        const el = document.getElementById('cpt-letter');
        el.textContent = letter;
        el.className = 'cpt-letter';

        if (isProbe && letter === 'X') {
            // Visual highlight so the participant knows this is the target letter
            el.classList.add('cpt-target');
        }
    }

    _hideLetter() {
        const el = document.getElementById('cpt-letter');
        el.textContent = '';
        el.className = 'cpt-letter';
    }

    _handleInput(e) {
        if (this.app.gamePaused) return; // ignore input while paused
        if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
        if (e.type === 'keydown') e.preventDefault();
        if (this.responded || !this.currentLetter) return;

        this.responded = true;
        const rt = performance.now() - this.stimulusStart;

        const el = document.getElementById('cpt-letter');

        // Determine what happened based on current trial state
        if (this.currentLetter === 'X') {
            // Responded to X probe
            if (this.currentTrialType === 'AX') {
                // AX false alarm: participant failed to inhibit despite A-context
                this.axFalseAlarms++;
                document.getElementById('cpt-false-alarms').textContent = this.axFalseAlarms;
                el.classList.add('cpt-error');
                this.app.audio.playWrong();
                this.app.audio.haptic([50, 30, 50]);
            } else {
                // BX hit: correct target detection (non-A context, X probe)
                this.bxHits++;
                this.reactionTimes.push(rt);
                document.getElementById('cpt-hits').textContent = this.bxHits;
                el.classList.add('cpt-hit');
                this.app.audio.playCorrect();
                this.app.audio.haptic(15);
                this._updateRT();
            }
        } else {
            // Commission error: responded to a non-X letter (context or non-target probe)
            this.totalFalseAlarms++;
            el.classList.add('cpt-error');
            this.app.audio.playWrong();
            this.app.audio.haptic([50, 30, 50]);
        }
    }

    /* Post-probe scoring: only runs if the participant did NOT press during
       the probe window. Classifies the silence as correct withhold or omission. */
    _evaluateTrial() {
        const trial = this.trialSequence[this.trialIdx - 1];
        if (!trial) return;

        if (trial.probe === 'X' && trial.type === 'AX' && !this.responded) {
            // Correct inhibition: withheld response to X after A-context
            this.axCorrectInhibits++;
            document.getElementById('cpt-ax-inhibit').textContent = this.axCorrectInhibits;
        } else if (trial.probe === 'X' && trial.type === 'BX' && !this.responded) {
            // Omission error: failed to respond to target X after non-A context
            this.bxMisses++;
        } else if (trial.probe !== 'X' && !this.responded) {
            // Correct withhold: no response needed for non-X probes
            if (trial.type === 'AY') this.ayCorrectRejects++;
            else this.byCorrectRejects++;
        }
    }

    _updateRT() {
        if (this.reactionTimes.length > 0) {
            const avg = Math.round(this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length);
            document.getElementById('cpt-rt').textContent = avg + 'ms';
        }
    }

    getResults() {
        const avgRT = this.reactionTimes.length > 0
            ? Math.round(this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length)
            : 0;
        const rtSD = this.reactionTimes.length > 1
            ? Math.round(Math.sqrt(this.reactionTimes.reduce((sum, rt) => sum + (rt - avgRT) ** 2, 0) / (this.reactionTimes.length - 1)))
            : 0;

        // d-prime: signal-detection sensitivity index
        // hitRate = BX hits / total BX trials; clamped [0.01, 0.99]
        const hitRate = this.bxHits + this.bxMisses > 0
            ? Math.min(0.99, Math.max(0.01, this.bxHits / (this.bxHits + this.bxMisses)))
            : 0.5;
        // faRate = AX false alarms / total AX trials; clamped [0.01, 0.99]
        const axTotal = this.axFalseAlarms + this.axCorrectInhibits;
        const faRate = axTotal > 0
            ? Math.min(0.99, Math.max(0.01, this.axFalseAlarms / axTotal))
            : 0.5;

        // d' = Z(hitRate) − Z(faRate); higher values = better discrimination
        const zHit = this._probit(hitRate);
        const zFA = this._probit(faRate);
        const dPrime = Math.round((zHit - zFA) * 100) / 100;

        const accuracy = this.totalTrials > 0
            ? Math.round(((this.bxHits + this.axCorrectInhibits + this.ayCorrectRejects + this.byCorrectRejects) / this.totalTrials) * 100)
            : 0;

        const data = {
            bxHits: this.bxHits,
            bxMisses: this.bxMisses,
            axFalseAlarms: this.axFalseAlarms,
            axCorrectInhibits: this.axCorrectInhibits,
            totalFalseAlarms: this.totalFalseAlarms,
            avgRT, rtSD, dPrime, accuracy,
            totalTrials: this.totalTrials,
        };

        const displayText = `d'=${dPrime} | AX-FA: ${this.axFalseAlarms} | Hits: ${this.bxHits} | RT: ${avgRT}ms`;
        const summary = `d-prime: ${dPrime}<br>BX Hits: ${this.bxHits}<br>BX Misses: ${this.bxMisses}<br>AX False Alarms: ${this.axFalseAlarms}<br>AX Correct Inhibits: ${this.axCorrectInhibits}<br>Avg RT: ${avgRT}ms (SD: ${rtSD}ms)<br>Accuracy: ${accuracy}%<br><br><em>High AX false alarms = proactive control failure (context maintenance)<br>High overall false alarms = general disinhibition<br>Poor d-prime = sustained attention deficit</em>`;
        return { data, displayText, summary };
    }

    /* Inverse normal CDF (probit) via Acklam's piecewise rational approximation.
       Three regions: lower tail (p < 0.02425), central (0.02425 ≤ p ≤ 0.97575),
       and upper tail (p > 0.97575). Each uses a ratio of polynomials fitted to
       minimize absolute error (|ε| < 1.15e-9). */
    _probit(p) {
        if (p <= 0) p = 0.01;
        if (p >= 1) p = 0.99;
        if (p === 0.5) return 0;

        // Coefficients for the central region rational approximation
        const a1 = -3.969683028665376e+01;
        const a2 = 2.209460984245205e+02;
        const a3 = -2.759285104469687e+02;
        const a4 = 1.383577518672690e+02;
        const a5 = -3.066479806614716e+01;
        const a6 = 2.506628277459239e+00;

        const b1 = -5.447609879822406e+01;
        const b2 = 1.615858368580409e+02;
        const b3 = -1.556989798598866e+02;
        const b4 = 6.680131188771972e+01;
        const b5 = -1.328068155288572e+01;

        // Coefficients for the tail regions rational approximation
        const c1 = -7.784894002430293e-03;
        const c2 = -3.223964580411365e-01;
        const c3 = -2.400758277161838e+00;
        const c4 = -2.549732539343734e+00;
        const c5 = 4.374664141464968e+00;
        const c6 = 2.938163982698783e+00;

        const d1 = 7.784695709041462e-03;
        const d2 = 3.224671290700398e-01;
        const d3 = 2.445134137142996e+00;
        const d4 = 3.754408661907416e+00;

        const pLow = 0.02425;   // boundary between tail and central regions
        const pHigh = 1 - pLow;

        let q, r;

        if (p < pLow) {
            // Lower tail: rational approximation in sqrt(-2·ln(p))
            q = Math.sqrt(-2 * Math.log(p));
            return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
                   ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
        } else if (p <= pHigh) {
            // Central region: rational approximation in (p − 0.5)
            q = p - 0.5;
            r = q * q;
            return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
                   (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
        } else {
            // Upper tail: mirror of lower tail via symmetry of the normal distribution
            q = Math.sqrt(-2 * Math.log(1 - p));
            return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
                    ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
        }
    }
}
