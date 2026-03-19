/* ══════════════════════════════════════════════════════════
   GO / NO-GO TASK — Inhibitory control & reaction time
   ══════════════════════════════════════════════════════════
   Clinical background:
   - The 75/25 go/nogo ratio creates a prepotent "respond" bias so that
     withholding on nogo trials requires active inhibition.
   - Jittered stimulus and ISI timing prevents rhythmic anticipation,
     forcing sustained attention on every trial.
   - Four outcome categories: hit, miss (omission), false alarm
     (commission error), and correct rejection.
   - Commission error rate is the primary disinhibition metric; elevated
     rates correlate with impulsivity constructs (e.g., ADHD, ODD).
   - Reaction-time standard deviation is an ADHD-relevant biomarker:
     high intra-individual RT variability reflects attention-fluctuation
     independent of mean speed.
   ══════════════════════════════════════════════════════════ */
export class GoNoGoGame {
    constructor(app) {
        this.app = app;

        // Timing parameters (ms) — jittered for unpredictability.
        // Ranges chosen to prevent rhythmic anticipation while keeping
        // the task brisk enough to sustain engagement over 120 trials.
        this.STIMULUS_DURATION_MIN = 350;   // floor prevents near-zero display
        this.STIMULUS_DURATION_MAX = 700;   // ceiling avoids tedium
        this.ISI_MIN = 400;                 // minimum recovery between trials
        this.ISI_MAX = 1800;                // long tail keeps participant alert

        // 75% go creates a strong prepotent "respond" tendency;
        // participants must actively inhibit on the minority 25% nogo trials.
        this.GO_RATIO = 0.75;
        this.TOTAL_TRIALS = 120;

        // State — phase tracks a simple state machine:
        //   idle → stimulus → isi → (loop back to stimulus) → done
        this.trials = [];
        this.currentTrialIdx = -1;
        this.phase = 'idle';      // idle | stimulus | isi | done
        this.stimulusOnset = 0;   // performance.now() timestamp at stimulus onset
        this.responded = false;   // single-response latch per trial
        this.phaseTimer = null;   // handle for the active setTimeout

        // Metrics
        this.hits = 0;            // correct go response
        this.misses = 0;          // missed go
        this.falseAlarms = 0;     // responded to nogo
        this.correctRejections = 0;
        this.reactionTimes = [];

        this._keyHandler = this._keyHandler.bind(this);
        this._respond = this._respond.bind(this);
        this._tapRespond = this._tapRespond.bind(this);
    }

    init() {
        this.hits = 0;
        this.misses = 0;
        this.falseAlarms = 0;
        this.correctRejections = 0;
        this.reactionTimes = [];
        this.currentTrialIdx = -1;
        this.phase = 'idle';
        this.responded = false;

        document.getElementById('gonogo-hits').textContent = '0';
        document.getElementById('gonogo-false-alarms').textContent = '0';
        document.getElementById('gonogo-misses').textContent = '0';
        document.getElementById('gonogo-rt').textContent = '--';

        // Generate trial sequence
        this._generateTrials();

        // Set up input handlers
        document.addEventListener('keydown', this._keyHandler);

        const area = document.getElementById('gonogo-area');
        area.addEventListener('click', this._respond);

        const tapBtn = document.getElementById('gonogo-tap-btn');
        tapBtn.addEventListener('click', this._tapRespond);

        // Start first trial after a brief delay
        const circle = document.getElementById('gonogo-circle');
        circle.className = 'gonogo-circle';
        setTimeout(() => this._nextTrial(), 500);
    }

    cleanup() {
        document.removeEventListener('keydown', this._keyHandler);
        const area = document.getElementById('gonogo-area');
        area.removeEventListener('click', this._respond);
        const tapBtn = document.getElementById('gonogo-tap-btn');
        tapBtn.removeEventListener('click', this._tapRespond);
        clearTimeout(this.phaseTimer);
        this.phase = 'done';
    }

    /** Tap button handler — stops propagation to avoid double-fire from area click */
    _tapRespond(e) {
        e.stopPropagation();
        this._respond();
    }

    /* Two-step trial construction:
       1. Generate the exact 75/25 ratio of go/nogo tokens.
       2. Fisher-Yates shuffle ensures uniform random ordering with no
          sequential bias — prevents predictable go/nogo streaks that
          would let participants anticipate trial type. */
    _generateTrials() {
        this.trials = [];
        // Step 1: populate with exact ratio
        for (let i = 0; i < this.TOTAL_TRIALS; i++) {
            this.trials.push(Math.random() < this.GO_RATIO ? 'go' : 'nogo');
        }
        // Step 2: Fisher-Yates shuffle — O(n), unbiased permutation
        for (let i = this.trials.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.trials[i], this.trials[j]] = [this.trials[j], this.trials[i]];
        }
    }

    /* Phase transition: isi/idle → stimulus.
       Captures onset with performance.now() for sub-ms RT precision.
       Stimulus duration is uniformly jittered within [MIN, MAX] to
       prevent temporal anticipation of the offset. */
    _nextTrial() {
        if (this.phase === 'done') return; // task already finished
        if (this.app.gamePaused) { setTimeout(() => this._nextTrial(), 100); return; }

        this.currentTrialIdx++;
        if (this.currentTrialIdx >= this.trials.length) {
            this.phase = 'done';
            return;
        }

        const trialType = this.trials[this.currentTrialIdx];
        this.responded = false;            // reset single-response latch
        this.phase = 'stimulus';           // transition into stimulus phase
        this.stimulusOnset = performance.now(); // high-resolution onset for RT

        // Show stimulus — CSS class drives go (green) vs nogo (red) styling
        const circle = document.getElementById('gonogo-circle');
        circle.className = 'gonogo-circle ' + trialType;

        // Jittered stimulus duration — uniform random within range
        const stimDur = this.STIMULUS_DURATION_MIN +
            Math.random() * (this.STIMULUS_DURATION_MAX - this.STIMULUS_DURATION_MIN);
        this.phaseTimer = setTimeout(() => {
            this._endStimulus();
        }, stimDur);
    }

    /* Stimulus timeout handler — scores non-responses then enters ISI.
       Omission (miss on go) and correct rejection (withhold on nogo)
       are both scored here because they can only be determined once the
       stimulus window has elapsed without a response.
       ISI is jittered to prevent rhythmic anticipation of the next trial. */
    _endStimulus() {
        if (this.phase === 'done') return;
        if (this.app.gamePaused) { setTimeout(() => this._endStimulus(), 100); return; }

        const trialType = this.trials[this.currentTrialIdx];

        // Score omission if go trial with no response
        if (trialType === 'go' && !this.responded) {
            this.misses++;
            document.getElementById('gonogo-misses').textContent = this.misses;
        }
        // Score correct rejection if nogo with no response
        if (trialType === 'nogo' && !this.responded) {
            this.correctRejections++;
        }

        // Transition to ISI phase — blank (neutral) circle
        this.phase = 'isi';
        const circle = document.getElementById('gonogo-circle');
        circle.className = 'gonogo-circle';

        // Jittered ISI — uniform random; wide range keeps the participant
        // from predicting the next stimulus onset
        const isi = this.ISI_MIN +
            Math.random() * (this.ISI_MAX - this.ISI_MIN);
        this.phaseTimer = setTimeout(() => {
            this._nextTrial();
        }, isi);
    }

    /* Handles any response (key, click, tap) during the active trial.
       Phase guard: only stimulus and isi phases accept input — idle and
       done are ignored. Single-response guard prevents double-counting.
       RT is computed from performance.now() delta against stimulusOnset. */
    _respond() {
        if (this.app.gamePaused) return; // ignore input while paused
        // Phase guard — ignore responses outside active trial window
        if (this.phase !== 'stimulus' && this.phase !== 'isi') return;
        // Single-response guard — only the first response per trial counts
        if (this.responded) return;
        this.responded = true;

        const trialType = this.trials[this.currentTrialIdx];
        const rt = performance.now() - this.stimulusOnset; // RT in ms
        const circle = document.getElementById('gonogo-circle');

        if (trialType === 'go') {
            // Hit — correct response to go stimulus
            this.hits++;
            this.reactionTimes.push(rt); // only go-hit RTs are clinically meaningful
            document.getElementById('gonogo-hits').textContent = this.hits;
            circle.classList.add('feedback-hit');
            this.app.audio.playCorrect();
            this.app.audio.haptic(25);

            // Update running average RT display
            const avgRT = Math.round(this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length);
            document.getElementById('gonogo-rt').textContent = avgRT + 'ms';
        } else {
            // False alarm (commission error) — failed to inhibit on nogo
            this.falseAlarms++;
            document.getElementById('gonogo-false-alarms').textContent = this.falseAlarms;
            circle.classList.add('feedback-fa');
            this.app.audio.playWrong();
            this.app.audio.haptic([50, 30, 50]); // double-pulse error pattern
        }

        // 150ms visual feedback flash — brief enough not to delay next trial
        setTimeout(() => {
            circle.classList.remove('feedback-hit', 'feedback-fa');
        }, 150);
    }

    /* Keyboard input — currentGame guard ensures keypresses are ignored
       when the user has navigated to a different task but this instance
       hasn't been cleaned up yet (e.g., during transition). */
    _keyHandler(e) {
        if (this.app.currentGame !== 'gonogo') return;
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            this._respond();
        }
    }

    /* Sample standard deviation of go-hit reaction times using Bessel's
       correction (n-1 denominator) for unbiased estimation from a sample.
       High RT SD is an ADHD biomarker — it reflects attention-fluctuation
       (moment-to-moment inconsistency) independent of mean RT speed.
       Returns 0 when fewer than 2 observations exist. */
    _rtSD() {
        if (this.reactionTimes.length < 2) return 0;
        const mean = this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length;
        // Bessel's correction: divide by (n - 1) for sample variance
        const variance = this.reactionTimes.reduce((sum, rt) => sum + (rt - mean) ** 2, 0) / (this.reactionTimes.length - 1);
        return Math.round(Math.sqrt(variance));
    }

    /* Derive clinical metrics from raw trial data.
       - accuracy: overall % correct across both go and nogo trials
       - commissionRate: % of nogo trials with a response (disinhibition index)
       - omissionRate: % of go trials without a response (inattention index)
       - avgRT: mean reaction time for go-hits only (motor speed)
       - rtSD: intra-individual RT variability (attention-fluctuation marker) */
    getResults() {
        const totalResponded = this.hits + this.falseAlarms;
        const totalTrials = this.currentTrialIdx + 1;
        const goTrials = this.trials.slice(0, totalTrials).filter(t => t === 'go').length;
        const nogoTrials = totalTrials - goTrials;

        // accuracy = (hits + correct rejections) / all trials
        const accuracy = totalTrials > 0 ? Math.round(((this.hits + this.correctRejections) / totalTrials) * 100) : 0;
        // commissionRate = false alarms / nogo trials — primary disinhibition metric
        const commissionRate = nogoTrials > 0 ? Math.round((this.falseAlarms / nogoTrials) * 100) : 0;
        // omissionRate = misses / go trials — inattention metric
        const omissionRate = goTrials > 0 ? Math.round((this.misses / goTrials) * 100) : 0;

        // avgRT computed only from go-hit trials (false-alarm RTs are excluded)
        const avgRT = this.reactionTimes.length > 0
            ? Math.round(this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length)
            : 0;
        // rtSD: see _rtSD() — ADHD attention-fluctuation biomarker
        const rtSD = this._rtSD();

        const data = {
            hits: this.hits,
            misses: this.misses,
            falseAlarms: this.falseAlarms,
            correctRejections: this.correctRejections,
            accuracy,
            commissionRate,
            omissionRate,
            avgRT,
            rtSD,
            totalTrials
        };

        const displayText = `${accuracy}% acc | Hits: ${this.hits} | FA: ${this.falseAlarms} | Miss: ${this.misses} | RT: ${avgRT}ms (\u00b1${rtSD})`;
        const summary = `Trials: ${totalTrials}<br>Accuracy: ${accuracy}%<br>Hits: ${this.hits}<br>Misses: ${this.misses}<br>False Alarms: ${this.falseAlarms}<br>Commission Rate: ${commissionRate}%<br>Omission Rate: ${omissionRate}%<br>Avg RT: ${avgRT}ms<br>RT Variability (SD): ${rtSD}ms`;

        return { data, displayText, summary };
    }
}
