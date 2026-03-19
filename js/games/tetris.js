/* ══════════════════════════════════════════════════════════
   TETRIS GAME — Visuospatial processing & planning
   ══════════════════════════════════════════════════════════

   Standard interface: constructor(app), init(), cleanup(), getResults()
   getResults() → { data, displayText, summary }

   Cognitive assessment context:
   Tetris engages multiple cognitive domains simultaneously, making it a
   useful tool for assessing visuospatial reasoning, mental rotation,
   forward planning, and psychomotor coordination under time pressure.
   Research (e.g., Haier et al., 1992) shows Tetris practice correlates
   with increased cortical thickness in areas associated with visuospatial
   processing. Key cognitive demands include:
   - Mental rotation: anticipating piece orientation before placement.
   - Spatial planning: evaluating optimal placement across the grid.
   - Processing speed: decisions must be made within the gravity interval.
   - Error recovery: adapting strategy after suboptimal placements.
   - Sustained attention: maintaining performance over the session duration.

   Session metrics (score, lines, level, game-overs, pieces placed) can be
   compared across sessions to track visuospatial and executive function
   trends. Game-overs are non-fatal (auto-reset after 1s) so the session
   yields continuous performance data rather than truncating at failure.

   Key design notes for reviewers:
   - Canvas is set up with HiDPI / Retina support via devicePixelRatio so
     blocks render crisp on high-density screens (see _setupCanvas).
   - The 7 standard tetrominoes (I, O, T, J, L, S, Z) are defined as 2-D
     binary arrays in SHAPES; each maps 1:1 to a colour in COLORS.
   - Rotation uses a simple wall-kick system: after rotating, if the piece
     collides it tries horizontal offsets [+1, -1, +2, -2] before giving up.
   - A ghost piece (faint white outline) shows where the active piece will land.
   - Game-over flashes a red overlay for 1 second then auto-resets the board
     so the session continues uninterrupted (game-overs are counted, not fatal).
   - Touch input is supported two ways: on-screen buttons (#tetris-touch) and
     swipe/tap gestures directly on the canvas (see _setupSwipeGestures).
   - The game loop runs via requestAnimationFrame. Pausing freezes the drop
     counter but keeps the rAF alive so the loop resumes cleanly on unpause.
   - Drop speed starts at 500 ms per row and decreases by 50 ms per level,
     floored at 80 ms. Level advances every 5 lines cleared.
*/
export class TetrisGame {
    /*
     * Constructor — piece definitions, board geometry, and session state.
     *
     * Board: standard 10×20 playfield (Tetris guideline spec). Each cell is
     * 25 CSS px; HiDPI scaling is handled separately in _setupCanvas.
     *
     * Piece definitions: the 7 standard tetrominoes (I, O, T, J, L, S, Z)
     * are stored as 2-D binary arrays in SHAPES. COLORS maps 1:1 by index.
     * Shapes are deep-copied on spawn so in-place rotation never mutates
     * the canonical definitions.
     *
     * Timing model: gravity interval decreases linearly with level (500ms
     * at level 1, -50ms per level, floor 80ms). Level increments every 5
     * lines cleared. This accelerating pressure curve is the primary
     * difficulty driver for the cognitive assessment.
     */
    constructor(app) {
        this.app = app;
        this.COLS = 10;    // playfield width in blocks
        this.ROWS = 20;    // playfield height in blocks
        this.BLOCK = 25;   // logical pixel size of one block (CSS pixels, before dpr scale)

        // One colour per tetromino, ordered to match SHAPES below.
        this.COLORS = ['#00d4ff', '#7b2ff7', '#2ecc71', '#e74c3c', '#f39c12', '#e91e63', '#1abc9c'];

        // Standard 7 tetrominoes represented as binary row arrays.
        // 1 = filled cell, 0 = empty cell. Row order is top-to-bottom.
        //   Index 0: I-piece  (1×4 horizontal bar)
        //   Index 1: O-piece  (2×2 square)
        //   Index 2: T-piece
        //   Index 3: J-piece
        //   Index 4: L-piece
        //   Index 5: S-piece
        //   Index 6: Z-piece
        this.SHAPES = [
            [[1,1,1,1]],
            [[1,1],[1,1]],
            [[0,1,0],[1,1,1]],
            [[1,0,0],[1,1,1]],
            [[0,0,1],[1,1,1]],
            [[0,1,1],[1,1,0]],
            [[1,1,0],[0,1,1]]
        ];

        // ── Runtime state ──────────────────────────────────────────────────────
        this.grid = null;           // 2-D array [ROWS][COLS]; 0 = empty, string = colour
        this.current = null;        // active falling piece { shape, color, x, y }
        this.next = null;           // piece queued to spawn next
        this.score = 0;
        this.linesCleared = 0;
        this.level = 1;
        this.gameOverCount = 0;     // total number of game-over events this session
        this.piecesPlaced = 0;      // total pieces that have locked into the grid
        this.dropCounter = 0;       // accumulated ms since last gravity step
        this.lastTime = 0;          // rAF timestamp from previous frame
        this.animFrame = null;      // rAF handle; null = loop not running
        this.paused = false;
        this.showingGameOver = false; // true during the 1-second game-over flash
        this.gameOverTimer = 0;       // performance.now() when game-over flash started
        this.ctx = null;            // 2D context for the main playfield canvas
        this.nextCtx = null;        // 2D context for the next-piece preview canvas

        // Cache devicePixelRatio once; used by _setupCanvas for HiDPI scaling.
        this.dpr = window.devicePixelRatio || 1;

        // Bind handlers so the same function reference can be added/removed.
        this._keyHandler = this._keyHandler.bind(this);
        this._loop = this._loop.bind(this);

        // Wire up touch controls at construction time so they are ready before
        // init() is called (buttons exist in static HTML, not created by init).
        this._setupTouchControls();
        this._setupSwipeGestures();
    }

    // ── HiDPI canvas helper ────────────────────────────────────────────────────
    // Sets both the CSS dimensions (logical pixels) and the backing-store
    // dimensions (logical × devicePixelRatio), then scales the context so all
    // subsequent draw calls use logical pixel coordinates — no call site needs
    // to know about dpr.
    _setupCanvas(canvas, logicalW, logicalH) {
        const dpr = this.dpr;
        canvas.style.width = logicalW + 'px';
        canvas.style.height = logicalH + 'px';
        canvas.width = Math.floor(logicalW * dpr);   // physical pixel width
        canvas.height = Math.floor(logicalH * dpr);  // physical pixel height
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr); // normalise to logical coordinates
        return ctx;
    }

    // ── On-screen touch button controls ───────────────────────────────────────
    // The #tetris-touch element contains buttons with data-action attributes.
    // Both touchstart (for mobile, passive:false so we can preventDefault) and
    // click (for mouse/pointer fallback) are registered on each button.
    _setupTouchControls() {
        document.querySelectorAll('#tetris-touch .touch-btn').forEach(btn => {
            const handler = (e) => {
                e.preventDefault();
                const action = btn.dataset.action;
                if (action === 'left') this._moveLeft();
                else if (action === 'right') this._moveRight();
                else if (action === 'rotate') this._rotate();
                else if (action === 'drop') this._hardDrop();
                else if (action === 'pause') this.togglePause();
            };
            btn.addEventListener('touchstart', handler, { passive: false });
            btn.addEventListener('click', handler);
        });
    }

    // ── Canvas swipe gesture controls ─────────────────────────────────────────
    // Interprets pointer events on the canvas itself as gestures:
    //   Tap (dx & dy both < MIN_SWIPE)  → rotate
    //   Horizontal swipe right/left      → move right / left
    //   Swipe down                       → hard drop
    //   Swipe up                         → rotate (alternative gesture)
    // Gestures longer than 500 ms are ignored to avoid accidental triggers.
    _setupSwipeGestures() {
        const canvas = document.getElementById('tetris-canvas');
        let startX = 0, startY = 0, startTime = 0;
        const MIN_SWIPE = 30; // minimum pixel displacement to count as a swipe

        canvas.addEventListener('pointerdown', (e) => {
            startX = e.clientX;
            startY = e.clientY;
            startTime = Date.now();
        });

        canvas.addEventListener('pointerup', (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const elapsed = Date.now() - startTime;
            if (elapsed > 500) return; // too slow — ignore

            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            if (absDx < MIN_SWIPE && absDy < MIN_SWIPE) {
                this._rotate();                              // tap → rotate
            } else if (absDx > absDy) {
                if (dx > 0) this._moveRight();              // swipe right
                else this._moveLeft();                      // swipe left
            } else {
                if (dy > 0) this._hardDrop();               // swipe down
                else this._rotate();                        // swipe up → rotate
            }
        });
    }

    // ── Session initialisation ─────────────────────────────────────────────────
    // Sets up both canvases, resets all state, spawns the first two pieces,
    // registers the keyboard handler, and starts the rAF game loop.
    init() {
        // Main playfield: COLS×ROWS blocks, each BLOCK logical pixels square.
        this.ctx = this._setupCanvas(document.getElementById('tetris-canvas'), this.COLS * this.BLOCK, this.ROWS * this.BLOCK);
        // Next-piece preview: fixed 100×100 logical pixel canvas.
        this.nextCtx = this._setupCanvas(document.getElementById('tetris-next-canvas'), 100, 100);

        // Initialise empty grid.
        this.grid = Array.from({ length: this.ROWS }, () => Array(this.COLS).fill(0));

        // Reset all session counters.
        this.score = 0;
        this.linesCleared = 0;
        this.level = 1;
        this.gameOverCount = 0;
        this.piecesPlaced = 0;
        this.dropCounter = 0;
        this.lastTime = 0;
        this.paused = false;
        this.showingGameOver = false;

        document.getElementById('tetris-score').textContent = '0';
        document.getElementById('tetris-lines').textContent = '0';
        document.getElementById('tetris-level').textContent = '1';
        document.getElementById('tetris-gameovers').textContent = '0';
        document.getElementById('tetris-timer').classList.remove('paused-flash');

        // Pre-generate two pieces: 'next' becomes 'current' on the first call
        // to _nextPiece(), keeping the queue primed at all times.
        this.next = this._spawnPiece();
        this._nextPiece();
        this._drawNext();

        document.addEventListener('keydown', this._keyHandler);
        this.animFrame = requestAnimationFrame(this._loop);
    }

    // ── Cleanup ────────────────────────────────────────────────────────────────
    // Stops the rAF loop and removes the keyboard listener. Called by the app
    // when switching away from Tetris or ending the session.
    cleanup() {
        this.paused = true;
        cancelAnimationFrame(this.animFrame);
        this.animFrame = null;
        document.removeEventListener('keydown', this._keyHandler);
        document.getElementById('tetris-timer').classList.remove('paused-flash');
    }

    // ── Pause / resume ─────────────────────────────────────────────────────────
    // The rAF loop continues running while paused so that unpausing is instant.
    // The app-level gamePaused flag tells the session timer to freeze as well.
    togglePause() {
        this.paused = !this.paused;
        this.app.gamePaused = this.paused;
        const timerEl = document.getElementById('tetris-timer');
        timerEl.classList.toggle('paused-flash', this.paused); // visual indicator
    }

    // ── Piece factory ──────────────────────────────────────────────────────────
    // Returns a new piece object with a random shape, its matching colour, and
    // an initial x position centred at the top of the playfield (y = 0).
    _spawnPiece() {
        const idx = Math.floor(Math.random() * this.SHAPES.length);
        return {
            shape: this.SHAPES[idx].map(r => [...r]), // deep copy so rotations don't mutate SHAPES
            color: this.COLORS[idx],
            x: Math.floor(this.COLS / 2) - Math.ceil(this.SHAPES[idx][0].length / 2),
            y: 0
        };
    }

    // ── Piece queue advance ────────────────────────────────────────────────────
    // Promotes 'next' to 'current' and spawns a fresh 'next'.
    // If the newly spawned current piece immediately collides (stack reached the
    // top), a game-over event is triggered: the overlay flash starts and the
    // board will auto-reset after 1 second (handled in _loop).
    _nextPiece() {
        this.current = this.next;
        this.next = this._spawnPiece();

        if (this._collides(this.current)) {
            // New piece overlaps existing cells — the board is full.
            this.gameOverCount++;
            this.showingGameOver = true;
            this.gameOverTimer = performance.now();
            document.getElementById('tetris-gameovers').textContent = this.gameOverCount;
            this.app.audio.playWrong();
        }
    }

    // ── Collision detection ────────────────────────────────────────────────────
    // Central constraint-checking function called by movement, rotation, drop,
    // and spawn logic. Returns true if any filled cell of 'piece' is outside
    // the playfield boundaries or overlaps a cell already locked in the grid.
    // Note: cells with y < 0 (above visible area) are allowed so pieces can
    // spawn partially off-screen — only negative x or too-large x/y block.
    _collides(piece) {
        for (let r = 0; r < piece.shape.length; r++) {
            for (let c = 0; c < piece.shape[r].length; c++) {
                if (!piece.shape[r][c]) continue;
                const nx = piece.x + c, ny = piece.y + r;
                if (nx < 0 || nx >= this.COLS || ny >= this.ROWS) return true;
                if (ny >= 0 && this.grid[ny][nx]) return true;
            }
        }
        return false;
    }

    // ── Lock piece into grid ───────────────────────────────────────────────────
    // Copies the piece's colour values into the permanent grid array and
    // increments the pieces-placed counter.
    _merge(piece) {
        for (let r = 0; r < piece.shape.length; r++) {
            for (let c = 0; c < piece.shape[r].length; c++) {
                if (!piece.shape[r][c]) continue;
                const ny = piece.y + r, nx = piece.x + c;
                if (ny >= 0 && ny < this.ROWS && nx >= 0 && nx < this.COLS) {
                    this.grid[ny][nx] = piece.color;
                }
            }
        }
        this.piecesPlaced++;
    }

    // ── Line-clear logic ───────────────────────────────────────────────────────
    // Scans the grid bottom-up; removes any fully filled row, inserts a blank
    // row at the top, and re-scans that index (r++) to handle multiple clears.
    //
    // Scoring follows a super-linear curve rewarding multi-line clears:
    //   1 line = 100 × level, 2 = 300, 3 = 500, 4 (Tetris) = 800.
    // This incentivises forward planning and risk management — key executive
    // function skills — since holding out for a 4-line clear risks stacking
    // too high and triggering a game-over.
    //
    // Level = floor(totalLines / 5) + 1 — one new level every 5 lines cleared.
    _clearLines() {
        let cleared = 0;
        for (let r = this.ROWS - 1; r >= 0; r--) {
            if (this.grid[r].every(c => c !== 0)) {
                this.grid.splice(r, 1);                        // remove full row
                this.grid.unshift(Array(this.COLS).fill(0));  // add blank at top
                cleared++;
                r++; // re-check same index after splice
            }
        }
        if (cleared > 0) {
            const pts = [0, 100, 300, 500, 800]; // points per simultaneous clear count
            this.score += (pts[cleared] || 800) * this.level;
            this.linesCleared += cleared;
            this.level = Math.floor(this.linesCleared / 5) + 1; // level-up every 5 lines
            document.getElementById('tetris-score').textContent = this.score;
            document.getElementById('tetris-lines').textContent = this.linesCleared;
            document.getElementById('tetris-level').textContent = this.level;
            this.app.audio.playLineClear();
        }
    }

    // ── Rotation with wall kicks ───────────────────────────────────────────────
    // Implements 90-degree clockwise mental rotation — the core visuospatial
    // operation in Tetris. The algorithm transposes the shape matrix then
    // reverses each row: new[c][rows-1-r] = old[r][c].
    //
    // Wall-kick system: if the rotated position collides, horizontal offsets
    // [+1, -1, +2, -2] are tried sequentially. This simplified kick table
    // (compared to the full SRS kick table) keeps the cognitive demand on
    // the player rather than relying on complex automated adjustments.
    // If all kicks fail, the rotation is cancelled (original shape restored).
    _rotate() {
        if (this.paused || this.showingGameOver || !this.current) return;
        const piece = this.current;
        const rows = piece.shape.length, cols = piece.shape[0].length;
        // Standard 90° CW rotation: new[c][rows-1-r] = old[r][c]
        const rotated = Array.from({ length: cols }, (_, c) =>
            Array.from({ length: rows }, (_, r) => piece.shape[rows - 1 - r][c])
        );
        const old = piece.shape;
        piece.shape = rotated;
        if (this._collides(piece)) {
            // Try wall kicks before giving up on the rotation.
            const kicks = [1, -1, 2, -2];
            let kicked = false;
            for (const k of kicks) {
                piece.x += k;
                if (!this._collides(piece)) { kicked = true; break; }
                piece.x -= k;
            }
            if (!kicked) piece.shape = old; // restore original shape if all kicks failed
        }
    }

    _moveLeft() {
        if (this.paused || this.showingGameOver || !this.current) return;
        this.current.x--;
        if (this._collides(this.current)) this.current.x++; // revert if wall collision
    }

    _moveRight() {
        if (this.paused || this.showingGameOver || !this.current) return;
        this.current.x++;
        if (this._collides(this.current)) this.current.x--; // revert if wall collision
    }

    // ── Hard drop ─────────────────────────────────────────────────────────────
    // Instantly drops the current piece to its lowest valid position by
    // repeatedly stepping y down until the next step would collide, then locks
    // it, clears lines, and advances to the next piece.
    _hardDrop() {
        if (this.paused || this.showingGameOver || !this.current) return;
        while (!this._collides({ ...this.current, shape: this.current.shape.map(r => [...r]), y: this.current.y + 1 })) {
            this.current.y++;
        }
        this._merge(this.current);
        this._clearLines();
        this.app.audio.playLock();
        this.app.audio.haptic(15);
        this._nextPiece();
        this.dropCounter = 0;
    }

    // ── Drop speed ─────────────────────────────────────────────────────────────
    // Returns the gravity interval in milliseconds for the current level.
    // Formula: 500ms − (level−1) × 50ms, floored at 80ms.
    // Level 1 = 500ms/row, Level 9 = 100ms/row, Level 10+ = 80ms/row (cap).
    _getDropSpeed() {
        return Math.max(80, 500 - (this.level - 1) * 50);
    }

    // ── requestAnimationFrame game loop ───────────────────────────────────────
    // Called every frame by the browser. Responsibilities:
    //   1. If paused: skip physics but reschedule so the loop stays alive.
    //   2. If game-over flash is showing: draw the overlay, wait 1 second,
    //      then clear the grid and spawn the next piece (auto-reset).
    //   3. Normal frame: accumulate delta time, step gravity when the drop
    //      interval elapses, lock the piece if it can no longer fall, then
    //      redraw.
    // Delta is capped at 250ms to prevent a large jump after a tab was
    // backgrounded or the browser was busy.
    _loop(time) {
        if (!this.animFrame && this.animFrame !== 0) return; // loop was cancelled

        if (this.paused) {
            this.lastTime = time;
            this.animFrame = requestAnimationFrame(this._loop);
            return;
        }

        if (this.showingGameOver) {
            // Draw the current (frozen) grid plus the red game-over overlay.
            this._draw();
            this._drawGameOverFlash();
            if (performance.now() - this.gameOverTimer > 1000) {
                // Flash duration elapsed — auto-reset the board and continue.
                this.showingGameOver = false;
                this.grid = Array.from({ length: this.ROWS }, () => Array(this.COLS).fill(0));
                this._nextPiece();
            }
            this.lastTime = time;
            this.animFrame = requestAnimationFrame(this._loop);
            return;
        }

        let delta = time - this.lastTime;
        if (delta > 250) delta = 250; // clamp to avoid physics jump after tab switch
        this.lastTime = time;
        this.dropCounter += delta;

        // Gravity step: move piece down one row when the drop interval elapses.
        if (this.dropCounter > this._getDropSpeed()) {
            if (this.current) {
                this.current.y++;
                if (this._collides(this.current)) {
                    // Piece can't move down — lock it and advance the queue.
                    this.current.y--;
                    this._merge(this.current);
                    this._clearLines();
                    this.app.audio.playLock();
                    this.app.audio.haptic(15);
                    this._nextPiece();
                }
            }
            this.dropCounter = 0;
        }

        this._draw();
        this._drawNext();
        this.animFrame = requestAnimationFrame(this._loop);
    }

    // ── Main canvas render ─────────────────────────────────────────────────────
    // Draws three layers in order (back to front, standard painter's algorithm):
    //   1. Background fill + subtle grid lines for spatial reference.
    //   2. Locked cells (stored in this.grid as colour strings).
    //   3. Ghost piece (translucent white) showing the projected landing
    //      position — provides feedforward visual information to aid planning.
    //   4. Active piece rendered on top in its assigned colour.
    // Entire frame is redrawn each tick; no dirty-rect optimisation needed
    // at this canvas size.
    _draw() {
        const ctx = this.ctx;
        const B = this.BLOCK;
        // Clear to dark background.
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, this.COLS * B, this.ROWS * B);

        // Subtle grid lines for visual reference.
        ctx.strokeStyle = '#1a1a30';
        ctx.lineWidth = 0.5;
        for (let r = 0; r <= this.ROWS; r++) {
            ctx.beginPath(); ctx.moveTo(0, r * B); ctx.lineTo(this.COLS * B, r * B); ctx.stroke();
        }
        for (let c = 0; c <= this.COLS; c++) {
            ctx.beginPath(); ctx.moveTo(c * B, 0); ctx.lineTo(c * B, this.ROWS * B); ctx.stroke();
        }

        // Draw all locked (landed) blocks from the grid array.
        for (let r = 0; r < this.ROWS; r++) {
            for (let c = 0; c < this.COLS; c++) {
                if (this.grid[r][c]) this._drawBlock(ctx, c, r, this.grid[r][c]);
            }
        }

        if (this.current && !this.showingGameOver) {
            // Ghost piece: project the current shape straight down until it
            // would collide, then render it as a faint white overlay so the
            // player can see where the piece will land.
            const ghostShape = this.current.shape.map(r => [...r]);
            let ghostY = this.current.y;
            while (!this._collides({ shape: ghostShape, x: this.current.x, y: ghostY + 1 })) ghostY++;
            for (let r = 0; r < ghostShape.length; r++) {
                for (let c = 0; c < ghostShape[r].length; c++) {
                    if (ghostShape[r][c]) {
                        ctx.fillStyle = 'rgba(255,255,255,0.08)';
                        ctx.fillRect((this.current.x + c) * B, (ghostY + r) * B, B, B);
                    }
                }
            }

            // Active piece rendered on top of the ghost.
            for (let r = 0; r < this.current.shape.length; r++) {
                for (let c = 0; c < this.current.shape[r].length; c++) {
                    if (this.current.shape[r][c]) {
                        this._drawBlock(ctx, this.current.x + c, this.current.y + r, this.current.color);
                    }
                }
            }
        }
    }

    // ── Game-over flash overlay ────────────────────────────────────────────────
    // Drawn on top of the frozen grid for 1 second. A red semi-transparent
    // rectangle fills the board and "GAME OVER / Resetting..." text is centred.
    // After 1 second the loop clears the grid and resumes play automatically.
    _drawGameOverFlash() {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(231, 76, 60, 0.3)';
        ctx.fillRect(0, 0, this.COLS * this.BLOCK, this.ROWS * this.BLOCK);
        ctx.fillStyle = '#e74c3c';
        ctx.font = 'bold 22px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', (this.COLS * this.BLOCK) / 2, (this.ROWS * this.BLOCK) / 2 - 10);
        ctx.font = '14px Segoe UI, sans-serif';
        ctx.fillStyle = '#ccc';
        ctx.fillText('Resetting...', (this.COLS * this.BLOCK) / 2, (this.ROWS * this.BLOCK) / 2 + 15);
        ctx.textAlign = 'start';
    }

    // ── Block renderer ─────────────────────────────────────────────────────────
    // Draws a single block at grid position (x, y) with a 1 px inset border
    // and a thin highlight stripe along the top edge for a subtle 3-D effect.
    _drawBlock(ctx, x, y, color) {
        const B = this.BLOCK;
        ctx.fillStyle = color;
        ctx.fillRect(x * B + 1, y * B + 1, B - 2, B - 2);
        // Top-edge highlight (semi-transparent white stripe).
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(x * B + 1, y * B + 1, B - 2, 3);
    }

    // ── Next-piece preview ─────────────────────────────────────────────────────
    // Renders this.next centred in the 100×100 preview canvas.
    // Offset is calculated to visually centre shapes up to 4 cells wide/tall.
    _drawNext() {
        const ctx = this.nextCtx;
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, 100, 100);
        if (!this.next) return;
        const shape = this.next.shape;
        const offX = Math.floor((4 - shape[0].length) / 2); // horizontal centering offset
        const offY = Math.floor((4 - shape.length) / 2);    // vertical centering offset
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c]) {
                    this._drawBlock(ctx, offX + c, offY + r, this.next.color);
                }
            }
        }
    }

    // ── Keyboard handler ───────────────────────────────────────────────────────
    // Only active when Tetris is the current game (guards against interfering
    // with other games' key bindings).
    //   Arrow Left  → move left
    //   Arrow Right → move right
    //   Arrow Down  → hard drop (instant fall)
    //   Arrow Up    → rotate CW
    //   Space       → toggle pause
    _keyHandler(e) {
        if (this.app.currentGame !== 'tetris') return;
        switch (e.key) {
            case 'ArrowLeft':
                this._moveLeft();
                e.preventDefault();
                break;
            case 'ArrowRight':
                this._moveRight();
                e.preventDefault();
                break;
            case 'ArrowDown':
                this._hardDrop();
                e.preventDefault();
                break;
            case 'ArrowUp':
                this._rotate();
                e.preventDefault();
                break;
            case ' ':
                this.togglePause();
                e.preventDefault();
                break;
        }
    }

    // ── Results ────────────────────────────────────────────────────────────────
    // Returns the session summary in the three formats expected by the app:
    //   data        — raw numbers for storage / further analysis
    //   displayText — compact one-line string shown in the results banner
    //   summary     — multi-line HTML shown in the results panel
    //
    // Clinical interpretation notes:
    //   - score & lines: overall visuospatial performance composite.
    //   - level: highest sustained processing speed tolerated.
    //   - piecesPlaced: throughput proxy; combined with game-overs gives
    //     an efficiency ratio (pieces per game-over).
    //   - gameOvers: error recovery frequency; high counts with high scores
    //     suggest impulsive but adaptive play style.
    getResults() {
        const data = {
            score: this.score,
            lines: this.linesCleared,
            level: this.level,
            gameOvers: this.gameOverCount,
            piecesPlaced: this.piecesPlaced
        };
        const displayText = `Score: ${this.score} | ${this.linesCleared} lines | Lvl ${this.level} | ${this.gameOverCount} game overs`;
        const summary = `Score: ${this.score}<br>Lines cleared: ${this.linesCleared}<br>Level reached: ${this.level}<br>Pieces placed: ${this.piecesPlaced}<br>Game overs: ${this.gameOverCount}`;
        return { data, displayText, summary };
    }
}
