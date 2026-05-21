/* ══════════════════════════════════════════════════════════
   TRAIL MAKING TEST A — Processing speed (connect 1→25)
   ══════════════════════════════════════════════════════════

   Clinical background
   ───────────────────
   Trails A is a neuropsychological measure of visual scanning speed and
   psychomotor processing speed. The participant connects 25 numbered circles
   in ascending order (1→2→…→25) as quickly as possible. Time-to-completion
   is the primary score; errors are secondary. Norms are well-established and
   the test is sensitive to TBI, dementia, and medication effects.

   Interface contract (required by the game runner)
   ─────────────────────────────────────────────────
     constructor(app)  — receives the global app object (audio, currentGame, …)
     init()            — called when this game tab becomes active; resets state
                         and attaches event listeners
     cleanup()         — called when leaving this tab; removes event listeners
     getResults()      — returns { data, displayText, summary }
                           data        : plain object with numeric metrics
                           displayText : short one-line string for the HUD
                           summary     : HTML string for the results panel
   ══════════════════════════════════════════════════════════ */
export class TrailsAGame {
    constructor(app) {
        this.app = app;

        // Layout constants — logical pixels before DPI scaling
        this.NUM_CIRCLES = 25;
        this.RADIUS = 22;          // visual radius of each numbered circle
        this.CANVAS_W = 700;
        this.CANVAS_H = 500;

        // Runtime state — also reset in init() so the game can be replayed
        this.circles = [];
        this.nextTarget = 1;       // which number the participant must tap next
        this.trailsCompleted = 0;
        this.errorCount = 0;
        this.bestTime = Infinity;  // seconds; Infinity until at least one trail finishes
        this.trailStart = 0;       // performance.now() timestamp when trail began

        this.ctx = null;

        // Capture devicePixelRatio once at construction time. On HiDPI/Retina
        // screens this is typically 2; on standard displays it is 1.
        this.dpr = window.devicePixelRatio || 1;

        // Bind handlers once so the same function reference can be removed later
        this._handleClick = this._handleClick.bind(this);
        this._handleTouch = this._handleTouch.bind(this);
    }

    // ─── Public lifecycle ─────────────────────────────────────────────────────

    init() {
        // Reset all mutable state for a fresh session
        this.nextTarget = 1;
        this.trailsCompleted = 0;
        this.errorCount = 0;
        this.bestTime = Infinity;
        this.trailStart = performance.now();

        // Sync UI counters
        document.getElementById('trails-a-num').textContent = '1';
        document.getElementById('trails-a-best').textContent = '--';
        document.getElementById('trails-a-errors').textContent = '0';

        // Configure the canvas for HiDPI and store the 2D context
        const canvas = document.getElementById('trails-a-canvas');
        this.ctx = this._setupCanvas(canvas, this.CANVAS_W, this.CANVAS_H);

        // Attach input handlers (touch uses passive:false so we can call
        // preventDefault and block the subsequent synthetic click event)
        canvas.addEventListener('click', this._handleClick);
        canvas.addEventListener('touchstart', this._handleTouch, { passive: false });

        // Place circles randomly and render the initial frame
        this._generateCircles();
        this._draw();
    }

    cleanup() {
        // Remove listeners when the user navigates away from this tab so they
        // do not fire during other games
        const canvas = document.getElementById('trails-a-canvas');
        canvas.removeEventListener('click', this._handleClick);
        canvas.removeEventListener('touchstart', this._handleTouch);
    }

    // ─── Canvas setup ─────────────────────────────────────────────────────────

    /**
     * HiDPI canvas scaling.
     *
     * A canvas has two separate size concepts:
     *   • CSS size  (logical pixels) — what the layout engine uses
     *   • Buffer size (physical pixels) — what the GPU rasterises
     *
     * On a Retina display devicePixelRatio = 2, so we set the buffer to
     * logicalW × 2 and then call ctx.scale(2, 2) so that all subsequent draw
     * calls are expressed in logical pixels. Without this, the canvas appears
     * blurry on HiDPI screens.
     */
    _setupCanvas(canvas, logicalW, logicalH) {
        const dpr = this.dpr;
        canvas.style.width = logicalW + 'px';
        canvas.style.height = logicalH + 'px';
        canvas.width = Math.floor(logicalW * dpr);
        canvas.height = Math.floor(logicalH * dpr);
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        return ctx;
    }

    // ─── Circle placement ─────────────────────────────────────────────────────

    /**
     * Randomly places 25 numbered circles with a minimum inter-circle distance.
     *
     * Algorithm: rejection sampling — for each circle, generate random (x, y)
     * candidates and accept the first one that is at least minDist pixels from
     * every already-placed circle. Up to maxAttempts candidates are tried.
     *
     * Fallback to grid layout: if all maxAttempts candidates are rejected (very
     * rare — only possible in edge cases like an abnormally small canvas), the
     * circle is placed at a deterministic grid position so the trail is always
     * completeable.
     *
     * A padding of RADIUS + 10px keeps circles fully inside the canvas border.
     * minDist = RADIUS × 3 ensures circles do not visually overlap and are
     * comfortably tappable on touch screens.
     */
    _generateCircles() {
        this.circles = [];
        const pad = this.RADIUS + 10;
        const minDist = this.RADIUS * 3;
        const maxAttempts = 500;

        for (let i = 1; i <= this.NUM_CIRCLES; i++) {
            let placed = false;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const x = pad + Math.random() * (this.CANVAS_W - pad * 2);
                const y = pad + Math.random() * (this.CANVAS_H - pad * 2);

                // Check distance against every already-placed circle
                let tooClose = false;
                for (const c of this.circles) {
                    const dx = c.x - x;
                    const dy = c.y - y;
                    if (Math.sqrt(dx * dx + dy * dy) < minDist) {
                        tooClose = true;
                        break;
                    }
                }

                if (!tooClose) {
                    this.circles.push({ num: i, x, y, found: false });
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                // Fallback: place in grid pattern
                // Divides the canvas into a 5-column grid and steps down rows.
                // This guarantees placement even when random sampling fails.
                const cols = 5;
                const row = Math.floor((i - 1) / cols);
                const col = (i - 1) % cols;
                const x = pad + col * ((this.CANVAS_W - pad * 2) / (cols - 1));
                const y = pad + row * ((this.CANVAS_H - pad * 2) / 4);
                this.circles.push({ num: i, x, y, found: false });
            }
        }

        // Reset sequence pointer and start the per-trail timer
        this.nextTarget = 1;
        this.trailStart = performance.now();
    }

    // ─── Input handling ───────────────────────────────────────────────────────

    /**
     * Touch handler — translates the first touch point from viewport coordinates
     * to logical canvas coordinates, accounting for any CSS scaling applied to
     * the canvas element (e.g. when the page is zoomed or the canvas is
     * displayed at a width other than CANVAS_W).
     *
     * preventDefault() suppresses the 300 ms synthetic click that mobile browsers
     * fire after a touch, preventing each tap from being counted twice.
     */
    _handleTouch(e) {
        e.preventDefault();
        const touch = e.touches[0];
        const canvas = document.getElementById('trails-a-canvas');
        const rect = canvas.getBoundingClientRect();
        // scaleX/scaleY account for any CSS-level resize of the canvas element
        const scaleX = this.CANVAS_W / rect.width;
        const scaleY = this.CANVAS_H / rect.height;
        const x = (touch.clientX - rect.left) * scaleX;
        const y = (touch.clientY - rect.top) * scaleY;
        this._processClick(x, y);
    }

    /** Mouse click handler — same coordinate mapping as the touch handler. */
    _handleClick(e) {
        const canvas = document.getElementById('trails-a-canvas');
        const rect = canvas.getBoundingClientRect();
        const scaleX = this.CANVAS_W / rect.width;
        const scaleY = this.CANVAS_H / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        this._processClick(x, y);
    }

    /**
     * Core click/tap logic.
     *
     * Hit detection: uses a circular hit region of RADIUS + 8px. The extra 8px
     * makes tapping reliable on touch screens where finger contact area is
     * larger than a mouse cursor. Only un-found circles are tested.
     *
     * Correct tap: marks the circle found, advances nextTarget, plays audio
     * feedback, and checks whether all 25 circles have been connected (trail
     * complete). On trail completion a brief 800 ms pause lets the participant
     * see the finished trail before circles are regenerated.
     *
     * Incorrect tap: increments the error counter, plays an error sound/haptic,
     * and flashes the wrong circle red — the participant must then tap the
     * correct circle; there is no penalty beyond the error count and lost time.
     */
    _processClick(x, y) {
        // Find which circle was clicked
        let clickedCircle = null;
        const hitRadius = this.RADIUS + 8; // generous touch target

        for (const c of this.circles) {
            if (c.found) continue;
            const dx = c.x - x;
            const dy = c.y - y;
            if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) {
                clickedCircle = c;
                break;
            }
        }

        if (!clickedCircle) return;

        if (clickedCircle.num === this.nextTarget) {
            // Correct
            clickedCircle.found = true;
            this.nextTarget++;
            this.app.audio.playCorrect();
            this.app.audio.haptic(25);

            if (this.nextTarget > this.NUM_CIRCLES) {
                // Trail complete — record time and start a new trail
                this.trailsCompleted++;
                const elapsed = (performance.now() - this.trailStart) / 1000;
                if (elapsed < this.bestTime) this.bestTime = elapsed;
                document.getElementById('trails-a-best').textContent = this.bestTime.toFixed(1) + 's';
                document.getElementById('trails-a-num').textContent = this.trailsCompleted + 1;

                // Start new trail after brief pause
                setTimeout(() => {
                    this._generateCircles();
                    this._draw();
                }, 800);
            }

            this._draw();
        } else {
            // Error
            this.errorCount++;
            document.getElementById('trails-a-errors').textContent = this.errorCount;
            this.app.audio.playWrong();
            this.app.audio.haptic([50, 30, 50]);

            // Flash the wrong circle red briefly
            this._flashError(clickedCircle);
        }
    }

    // ─── Rendering ────────────────────────────────────────────────────────────

    /**
     * Momentary error flash — paints a translucent red overlay on the tapped
     * circle without triggering a full redraw, then schedules a full redraw
     * 300 ms later to restore the normal appearance.
     */
    _flashError(circle) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.arc(circle.x, circle.y, this.RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(231, 76, 60, 0.5)';
        ctx.fill();

        setTimeout(() => this._draw(), 300);
    }

    /**
     * Full canvas redraw — called after every state change.
     *
     * Rendering layers (back to front):
     *   1. Background fill
     *   2. Connecting trail lines — drawn between all found circles in numeric
     *      order. The semi-transparent purple stroke lets the line show
     *      directionality without obscuring the circles beneath it.
     *   3. Circle fills and strokes:
     *        found    → dark green fill, green border
     *        next     → dark purple fill, bright purple border (highlights target)
     *        idle     → dark blue fill, muted border
     *   4. Number labels — colour mirrors the circle state for consistency.
     *
     * The next target circle is visually highlighted so the participant always
     * knows which number to tap next; this is intentional (Trails A measures
     * speed, not memory).
     */
    _draw() {
        const ctx = this.ctx;
        const R = this.RADIUS;

        // Clear
        ctx.fillStyle = '#0d0d20';
        ctx.fillRect(0, 0, this.CANVAS_W, this.CANVAS_H);

        // Draw connecting lines for found circles
        const found = this.circles.filter(c => c.found).sort((a, b) => a.num - b.num);
        if (found.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = '#4f8cff44';
            ctx.lineWidth = 3;
            ctx.moveTo(found[0].x, found[0].y);
            for (let i = 1; i < found.length; i++) {
                ctx.lineTo(found[i].x, found[i].y);
            }
            ctx.stroke();
        }

        // Draw circles
        for (const c of this.circles) {
            // Circle background
            ctx.beginPath();
            ctx.arc(c.x, c.y, R, 0, Math.PI * 2);

            if (c.found) {
                ctx.fillStyle = '#1a3a1a';
                ctx.strokeStyle = '#2ecc71';
            } else if (c.num === this.nextTarget) {
                // Highlight the next target so the participant knows what to tap
                ctx.fillStyle = '#2a1a4a';
                ctx.strokeStyle = '#4f8cff';
            } else {
                ctx.fillStyle = '#1a1a35';
                ctx.strokeStyle = '#2a2a4a';
            }

            ctx.fill();
            ctx.lineWidth = 2;
            ctx.stroke();

            // Number label
            ctx.fillStyle = c.found ? '#2ecc71' : (c.num === this.nextTarget ? '#4f8cff' : '#999');
            ctx.font = 'bold 16px Segoe UI, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(c.num, c.x, c.y);
        }

        // Restore default text alignment so other canvas users are not affected
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }

    // ─── Results ──────────────────────────────────────────────────────────────

    /**
     * Returns standardised result object.
     *
     * bestTime is reported as 999 when no trail was completed (Infinity
     * sentinel replaced to keep the data JSON-safe). The primary clinical
     * metric is bestTime (seconds); errors are secondary.
     *
     * Reviewers: bestTime from Trails A feeds the B–A difference calculation
     * in TrailsBGame.getResults() to isolate executive function cost.
     */
    getResults() {
        const best = this.bestTime === Infinity ? 999 : parseFloat(this.bestTime.toFixed(1));
        const data = {
            trailsCompleted: this.trailsCompleted,
            totalErrors: this.errorCount,
            bestTime: best
        };
        const bestStr = best < 999 ? best.toFixed(1) + 's' : '--';
        const displayText = `${this.trailsCompleted} trails | ${this.errorCount} errors | Best: ${bestStr}`;
        const summary = `Trails completed: ${this.trailsCompleted}<br>Total errors: ${this.errorCount}<br>Best trail time: ${bestStr}`;
        return { data, displayText, summary };
    }
}
