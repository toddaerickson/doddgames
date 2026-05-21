/* ══════════════════════════════════════════════════════════
   TRAIL MAKING TEST B — Executive function (set-shifting)
   Alternate: 1→A→2→B→3→C→...→13→L
   ══════════════════════════════════════════════════════════
   Clinical background:
   - TMT-B measures cognitive flexibility / set-shifting: the participant
     must alternate between two learned sequences (numbers, letters),
     which requires executive control beyond simple visual search.
   - The B-A difference (TMT-B time minus TMT-A time) isolates the
     set-shifting cost by subtracting out motor speed and scanning.
   - Strongly associated with frontal-lobe integrity; deficits appear
     early in dementia, TBI, and ADHD executive-function profiles.
   ══════════════════════════════════════════════════════════ */
export class TrailsBGame {
    constructor(app) {
        this.app = app;

        // Sequence composition: 13 numbers + 12 letters = 25 circles.
        // Letters stop at L (12th) so both sets interleave evenly with
        // one extra number (13) at the end.
        this.NUM_NUMBERS = 13;
        this.LETTERS = 'ABCDEFGHIJKL'.split('');
        this.TOTAL_CIRCLES = this.NUM_NUMBERS + this.LETTERS.length; // 25
        this.RADIUS = 22;
        this.CANVAS_W = 700;    // logical (CSS) pixels
        this.CANVAS_H = 500;

        this.circles = [];
        this.sequence = [];       // the correct order: ['1','A','2','B','3','C',...]
        this.nextIdx = 0;         // index into this.sequence for current target
        this.trailsCompleted = 0;
        this.errorCount = 0;
        this.bestTime = Infinity;
        this.trailStart = 0;

        this.ctx = null;
        // DPI scaling: canvas is sized at dpr multiple then CSS-scaled down,
        // so text and lines render crisply on high-density displays.
        this.dpr = window.devicePixelRatio || 1;

        this._handleClick = this._handleClick.bind(this);
        this._handleTouch = this._handleTouch.bind(this);
    }

    init() {
        this.nextIdx = 0;
        this.trailsCompleted = 0;
        this.errorCount = 0;
        this.bestTime = Infinity;

        document.getElementById('trails-b-num').textContent = '1';
        document.getElementById('trails-b-best').textContent = '--';
        document.getElementById('trails-b-errors').textContent = '0';
        document.getElementById('trails-b-next-target').textContent = '1';

        const canvas = document.getElementById('trails-b-canvas');
        this.ctx = this._setupCanvas(canvas, this.CANVAS_W, this.CANVAS_H);

        canvas.addEventListener('click', this._handleClick);
        canvas.addEventListener('touchstart', this._handleTouch, { passive: false });

        this._buildSequence();
        this._generateCircles();
        this._draw();
    }

    cleanup() {
        const canvas = document.getElementById('trails-b-canvas');
        canvas.removeEventListener('click', this._handleClick);
        canvas.removeEventListener('touchstart', this._handleTouch);
    }

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

    /* Builds the canonical alternating sequence: ['1','A','2','B',...,'13','L'].
       All entries are strings for uniform comparison in _processClick —
       numeric labels are String(n) so === works against circle.label
       without type coercion. Output length = 25 (13 numbers + 12 letters). */
    _buildSequence() {
        this.sequence = [];
        for (let i = 0; i < this.NUM_NUMBERS; i++) {
            this.sequence.push(String(i + 1));  // number as string
            if (i < this.LETTERS.length) {
                this.sequence.push(this.LETTERS[i]); // interleaved letter
            }
        }
    }

    /* Place 25 circles via rejection sampling: random candidate positions
       are tested against all already-placed circles for a minimum distance.
       isLetter flag is derived via isNaN(parseInt(label)) — letters parse
       to NaN, numbers don't — used later for category-based visual styling.
       Grid fallback: if a label can't be placed within maxAttempts, it
       gets a deterministic grid position so the layout never fails. */
    _generateCircles() {
        this.circles = [];
        const pad = this.RADIUS + 10;   // edge padding to keep circles on-canvas
        const minDist = this.RADIUS * 3; // separation prevents overlap / misclicks
        const maxAttempts = 500;         // rejection-sampling cap per circle

        // Create labels: numbers 1-13 and letters A-L
        const labels = [];
        for (let i = 1; i <= this.NUM_NUMBERS; i++) labels.push(String(i));
        for (const l of this.LETTERS) labels.push(l);

        for (const label of labels) {
            let placed = false;
            // Rejection sampling: try random positions until one fits
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const x = pad + Math.random() * (this.CANVAS_W - pad * 2);
                const y = pad + Math.random() * (this.CANVAS_H - pad * 2);

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
                    // isLetter: parseInt('A') → NaN → isNaN = true
                    const isLetter = isNaN(parseInt(label));
                    this.circles.push({ label, x, y, found: false, isLetter });
                    placed = true;
                    break;
                }
            }

            // Grid fallback — guarantees placement when random sampling exhausted
            if (!placed) {
                const idx = labels.indexOf(label);
                const cols = 5;
                const row = Math.floor(idx / cols);
                const col = idx % cols;
                const x = pad + col * ((this.CANVAS_W - pad * 2) / (cols - 1));
                const y = pad + row * ((this.CANVAS_H - pad * 2) / 4);
                const isLetter = isNaN(parseInt(label));
                this.circles.push({ label, x, y, found: false, isLetter });
            }
        }

        this.nextIdx = 0;
        this.trailStart = performance.now(); // timer starts at circle generation
        this._updateNextTarget();
    }

    _updateNextTarget() {
        const target = this.nextIdx < this.sequence.length ? this.sequence[this.nextIdx] : '--';
        document.getElementById('trails-b-next-target').textContent = target;
    }

    _handleTouch(e) {
        e.preventDefault();
        const touch = e.touches[0];
        const canvas = document.getElementById('trails-b-canvas');
        const rect = canvas.getBoundingClientRect();
        const scaleX = this.CANVAS_W / rect.width;
        const scaleY = this.CANVAS_H / rect.height;
        const x = (touch.clientX - rect.left) * scaleX;
        const y = (touch.clientY - rect.top) * scaleY;
        this._processClick(x, y);
    }

    _handleClick(e) {
        const canvas = document.getElementById('trails-b-canvas');
        const rect = canvas.getBoundingClientRect();
        const scaleX = this.CANVAS_W / rect.width;
        const scaleY = this.CANVAS_H / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        this._processClick(x, y);
    }

    /* Core game logic — the alternating number/letter constraint is the
       set-shifting cognitive load that differentiates TMT-B from TMT-A.
       Participants must maintain two concurrent sequences and switch
       between them on every click, which taxes executive function. */
    _processClick(x, y) {
        const hitRadius = this.RADIUS + 8; // generous hit area for touch targets
        let clickedCircle = null;

        // Find which unfound circle was clicked (if any)
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

        // Check against the expected next label in the alternating sequence
        const expectedLabel = this.sequence[this.nextIdx];

        if (clickedCircle.label === expectedLabel) {
            clickedCircle.found = true;
            this.nextIdx++;
            this.app.audio.playCorrect();
            this.app.audio.haptic(25);
            this._updateNextTarget();

            if (this.nextIdx >= this.sequence.length) {
                this.trailsCompleted++;
                const elapsed = (performance.now() - this.trailStart) / 1000;
                if (elapsed < this.bestTime) this.bestTime = elapsed;
                document.getElementById('trails-b-best').textContent = this.bestTime.toFixed(1) + 's';
                document.getElementById('trails-b-num').textContent = this.trailsCompleted + 1;

                setTimeout(() => {
                    this._generateCircles();
                    this._draw();
                }, 800);
            }

            this._draw();
        } else {
            this.errorCount++;
            document.getElementById('trails-b-errors').textContent = this.errorCount;
            this.app.audio.playWrong();
            this.app.audio.haptic([50, 30, 50]);
            this._flashError(clickedCircle);
        }
    }

    _flashError(circle) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.arc(circle.x, circle.y, this.RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(231, 76, 60, 0.5)';
        ctx.fill();
        setTimeout(() => this._draw(), 300);
    }

    _draw() {
        const ctx = this.ctx;
        const R = this.RADIUS;

        ctx.fillStyle = '#0d0d20';
        ctx.fillRect(0, 0, this.CANVAS_W, this.CANVAS_H);

        /* Trail lines trace the sequence order (1→A→2→B→...), NOT spatial
           proximity. This visualises the alternating path the participant
           has constructed so far. */
        const foundInOrder = [];
        for (let i = 0; i < this.nextIdx; i++) {
            const label = this.sequence[i];
            const c = this.circles.find(ci => ci.label === label);
            if (c) foundInOrder.push(c);
        }

        if (foundInOrder.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = '#4f8cff44'; // semi-transparent accent trail
            ctx.lineWidth = 3;
            ctx.moveTo(foundInOrder[0].x, foundInOrder[0].y);
            for (let i = 1; i < foundInOrder.length; i++) {
                ctx.lineTo(foundInOrder[i].x, foundInOrder[i].y);
            }
            ctx.stroke();
        }

        // Draw circles with category-based styling
        const currentTarget = this.nextIdx < this.sequence.length ? this.sequence[this.nextIdx] : null;

        for (const c of this.circles) {
            ctx.beginPath();
            ctx.arc(c.x, c.y, R, 0, Math.PI * 2);

            if (c.found) {
                ctx.fillStyle = '#1a3a1a';
                ctx.strokeStyle = '#2ecc71';  // green = completed
            } else if (c.label === currentTarget) {
                ctx.fillStyle = '#2a1a4a';
                ctx.strokeStyle = '#4f8cff';  // purple = active target
            } else {
                // Letter circles get a blue tint for category identity,
                // helping distinguish the two sets at a glance
                ctx.fillStyle = c.isLetter ? '#1a2535' : '#1a1a35';
                ctx.strokeStyle = c.isLetter ? '#2a4a5a' : '#2a2a4a';
            }

            ctx.fill();
            ctx.lineWidth = 2;
            ctx.stroke();

            // Label text — letters rendered in blue-toned color for category
            if (c.found) {
                ctx.fillStyle = '#2ecc71';
            } else if (c.label === currentTarget) {
                ctx.fillStyle = '#4f8cff';
            } else {
                ctx.fillStyle = c.isLetter ? '#6ab0c9' : '#999';
            }
            ctx.font = 'bold 16px Segoe UI, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(c.label, c.x, c.y);
        }

        // Reset text alignment to avoid affecting external draw calls
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }

    /* Results summary. Note: the B-A difference (TMT-B time minus TMT-A
       time) is the key clinical metric for isolating set-shifting cost,
       but it requires TMT-A data from a separate task instance; the
       reminder is included in the summary text for the clinician. */
    getResults() {
        // 999 sentinel indicates no trail was completed
        const best = this.bestTime === Infinity ? 999 : parseFloat(this.bestTime.toFixed(1));
        const data = {
            trailsCompleted: this.trailsCompleted,
            totalErrors: this.errorCount,
            bestTime: best
        };
        const bestStr = best < 999 ? best.toFixed(1) + 's' : '--';
        const displayText = `${this.trailsCompleted} trails | ${this.errorCount} errors | Best: ${bestStr}`;
        const summary = `Trails completed: ${this.trailsCompleted}<br>Total errors: ${this.errorCount}<br>Best trail time: ${bestStr}<br><br><em>B\u2013A difference measures executive function cost of set-shifting</em>`;
        return { data, displayText, summary };
    }
}
