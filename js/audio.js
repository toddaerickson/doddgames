/* ══════════════════════════════════════════════════════════
   AUDIO MANAGER — Web Audio API sound effects + haptic
   ══════════════════════════════════════════════════════════
   All sound is generated programmatically via the Web Audio API —
   no audio files are fetched. An AudioContext is created lazily on
   the first user interaction to comply with browser autoplay policy
   (browsers block AudioContext creation before a gesture has occurred).
   ══════════════════════════════════════════════════════════ */
export class AudioManager {
    /**
     * Sets up lazy AudioContext initialization.
     * The context is NOT created here; it is deferred until the first
     * click or keydown event so browsers do not block audio before a
     * user gesture has occurred (autoplay policy).
     */
    constructor() {
        this.ctx = null;
        this.muted = false;
        this._initOnInteraction = this._initOnInteraction.bind(this);
        // { once: true } ensures these listeners fire exactly once and
        // self-remove, keeping overhead minimal for the rest of the session
        document.addEventListener('click', this._initOnInteraction, { once: true });
        document.addEventListener('keydown', this._initOnInteraction, { once: true });
    }

    /**
     * Creates the AudioContext on the first user interaction.
     * Only runs once because both listeners are registered with { once: true }.
     * The webkitAudioContext fallback covers older Safari versions.
     */
    _initOnInteraction() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    /**
     * Ensures an AudioContext exists and is in the 'running' state before
     * any tone is synthesized. This guards against two edge cases:
     *   1. A sound method is called before any user interaction has occurred.
     *   2. The context was suspended (e.g. by _handleVisibilityChange in app.js)
     *      and a new sound is requested before the resume promise resolves.
     */
    _ensureCtx() {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    /**
     * Toggles global mute on/off and updates the sound-toggle button icon.
     * When muted, all _playTone() calls and haptic() calls return early,
     * so no audio nodes are created at all.
     */
    toggleMute() {
        this.muted = !this.muted;
        const btn = document.getElementById('sound-toggle');
        btn.textContent = this.muted ? '\u{1F507}' : '\u{1F50A}';
        btn.classList.toggle('muted', this.muted);
    }

    /**
     * Triggers a device vibration pattern when available (mobile devices).
     * Silently skipped when muted or when the Vibration API is not supported.
     *
     * @param {number|number[]} pattern - Duration in ms, or array of on/off durations
     */
    haptic(pattern) {
        if (this.muted) return;
        if ('vibrate' in navigator) {
            navigator.vibrate(pattern);
        }
    }

    /**
     * Core synthesis primitive used by all public sound methods.
     * Creates a single-oscillator → gain node chain, applies an
     * exponential volume ramp to produce a natural decay, then
     * connects and auto-stops the oscillator at the end of `duration`.
     * All nodes are self-contained and garbage-collected after stopping.
     *
     * @param {number} freq     - Oscillator frequency in Hz
     * @param {number} duration - Tone length in seconds
     * @param {OscillatorType} type   - Oscillator waveform ('sine', 'square', etc.)
     * @param {number} volume   - Peak gain level (0.0 – 1.0; keep low to avoid clipping)
     */
    _playTone(freq, duration, type = 'sine', volume = 0.12) {
        if (this.muted) return;
        this._ensureCtx();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    /**
     * Plays a two-note ascending chime (C5 → E5).
     * Triggered on every correct player action across all games
     * (e.g. tapping the right Schulte number, correct Stroop answer,
     * successful card sort, CPT target hit).
     */
    playCorrect() {
        this._playTone(523, 0.12, 'sine', 0.1);
        setTimeout(() => this._playTone(659, 0.15, 'sine', 0.1), 60);
    }

    /**
     * Plays a short low-pitched square-wave buzz.
     * Triggered on incorrect player actions (wrong tap, wrong key press,
     * false alarm in Go/No-Go or CPT, wrong card category).
     */
    playWrong() {
        this._playTone(200, 0.2, 'square', 0.08);
    }

    /**
     * Plays a single mid-range beep (A4).
     * Used for each tick of the pre-game countdown overlay (3, 2, 1)
     * and as a generic attention cue.
     */
    playBeep() {
        this._playTone(440, 0.15, 'sine', 0.1);
    }

    /**
     * Plays a quick three-note ascending fanfare (C5 → E5 → G5).
     * Triggered when the countdown overlay reaches "GO!" to signal
     * the start of gameplay.
     */
    playGo() {
        this._playTone(523, 0.1, 'sine', 0.12);
        setTimeout(() => this._playTone(659, 0.1, 'sine', 0.12), 50);
        setTimeout(() => this._playTone(784, 0.2, 'sine', 0.12), 100);
    }

    /**
     * Plays a three-note ascending chord (C5 → E5 → G5).
     * Triggered in Tetris when one or more complete lines are cleared.
     */
    playLineClear() {
        this._playTone(523, 0.15, 'sine', 0.1);
        setTimeout(() => this._playTone(659, 0.15, 'sine', 0.1), 50);
        setTimeout(() => this._playTone(784, 0.2, 'sine', 0.1), 100);
    }

    /**
     * Plays a brief high-pitched square-wave click.
     * Triggered in Tetris when a piece locks into place on the board.
     */
    playLock() {
        this._playTone(800, 0.04, 'square', 0.06);
    }

    /**
     * Plays a four-note ascending arpeggio (C5 → E5 → G5 → C6) spaced
     * 120 ms apart, forming a celebratory end-of-session jingle.
     * Triggered by App.endSession() when the 5-minute timer expires.
     */
    playComplete() {
        [523, 659, 784, 1047].forEach((f, i) => {
            setTimeout(() => this._playTone(f, 0.25, 'sine', 0.1), i * 120);
        });
    }
}
