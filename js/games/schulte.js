/* ══════════════════════════════════════════════════════════
   SCHULTE TABLE GAME — Peripheral vision & processing speed
   ══════════════════════════════════════════════════════════

   Standard interface: constructor(app), init(), cleanup(), getResults()
   getResults() → { data, displayText, summary }

   Clinical background:
   The Schulte Table is a well-established neuropsychological tool used
   to assess visual scanning speed, distributed (peripheral) attention,
   and information processing efficiency. Originally developed by
   psychiatrist Walter Schulte, the task requires rapid saccade-free
   identification of sequentially ordered numbers in a randomised grid.
   The subject fixates on the centre cell and locates each target using
   peripheral vision alone — making it a direct measure of the useful
   field of view (UFOV).

   Key clinical metrics:
   - Completion time per table: reflects processing speed and sustained
     attention. Normative data is typically gathered on 5×5 grids.
   - Error count: elevated errors suggest impulsive responding or
     difficulty maintaining the ordinal sequence in working memory.
   - Best-time trend across tables: fatigue effects manifest as
     increasing times; practice effects manifest as decreasing times.

   How it works:
   - A grid of randomly shuffled numbers is displayed.
   - The user clicks each number in ascending order (1, 2, 3, …).
   - The center cell is visually marked as a fixation point so the user
     practices finding numbers using peripheral vision rather than
     scanning the grid directly — this is the core cognitive challenge.
   - Each completed grid is one "table". A session runs multiple tables;
     the goal count varies by grid size (see setSize).
   - The fastest single-table completion time is tracked as bestTime
     across all tables in the session.
   - When the last table is finished the session ends automatically.
*/
export class SchulteGame {
    /*
     * Constructor — grid configuration and session state.
     *
     * Grid sizes supported: 3×3 (9 cells), 5×5 (25 cells, classic), 7×7 (49 cells).
     * Difficulty is driven entirely by grid size; larger grids demand wider
     * peripheral attention and longer sustained concentration.
     *
     * Session state tracks: current target number, tables completed, cumulative
     * errors, per-table start timestamp, and best (fastest) table time.
     */
    constructor(app) {
        this.app = app;
        this.gridSize = 5;          // default grid dimension (5×5 = 25 cells)
        this.totalCells = 25;       // gridSize², recalculated in setSize()
        this.tablesGoal = 5;        // how many tables the user must complete this session
        this.next = 1;              // the number the user must click next
        this.tablesCompleted = 0;   // tables finished so far this session
        this.errorCount = 0;        // cumulative mis-clicks across all tables
        this.tableStart = 0;        // performance.now() timestamp when current table began
        this.bestTime = Infinity;   // best single-table time (seconds); Infinity = none yet
    }

    // ── Difficulty / size selection ────────────────────────────────────────────
    // Called when the user picks a grid size via the difficulty buttons.
    // Supported sizes and their session table goals:
    //   3×3  → 8 tables  (easy;  9 cells, fast completion)
    //   5×5  → 5 tables  (medium; 25 cells, the classic Schulte size)
    //   7×7  → 3 tables  (hard;  49 cells, slow and demanding)
    setSize(size) {
        this.gridSize = size;
        this.totalCells = size * size;
        // Assign per-size table goals: more tables for smaller grids so session
        // length stays roughly consistent regardless of difficulty chosen.
        this.tablesGoal = size === 3 ? 8 : size === 7 ? 3 : 5;

        // Highlight the active difficulty button in the UI.
        document.querySelectorAll('#schulte-difficulty .diff-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.size) === size);
        });

        // Apply the matching CSS class so the board renders the correct column count.
        const board = document.getElementById('schulte-board');
        board.className = 'schulte-board grid-' + size;
        this.generateBoard();
        document.getElementById('schulte-table-num').textContent = `${Math.min(this.tablesCompleted + 1, this.tablesGoal)} / ${this.tablesGoal}`;
    }

    // ── Session initialisation ─────────────────────────────────────────────────
    // Resets all counters and renders the first table. Called once per session.
    init() {
        this.next = 1;
        this.tablesCompleted = 0;
        this.errorCount = 0;
        this.bestTime = Infinity;
        document.getElementById('schulte-errors').textContent = '0';
        document.getElementById('schulte-best').textContent = '--';
        document.getElementById('schulte-table-num').textContent = `1 / ${this.tablesGoal}`;

        const board = document.getElementById('schulte-board');
        board.className = 'schulte-board grid-' + this.gridSize;
        this.generateBoard();
    }

    // ── Board generation ───────────────────────────────────────────────────────
    // Creates a new randomised grid and starts the per-table timer.
    // Also resets this.next to 1 so each new table starts from scratch.
    //
    // Grid randomisation uses Fisher-Yates (Knuth) shuffle for uniform
    // distribution — important for assessment validity so that no spatial
    // bias is introduced by the shuffling algorithm.
    // The centre cell is designated as the fixation anchor, mirroring
    // the standard Schulte administration protocol.
    generateBoard() {
        this.next = 1;
        document.getElementById('schulte-next').textContent = '1';
        this.tableStart = performance.now(); // start timing this table

        // Build a sequential array [1 … totalCells] then Fisher-Yates shuffle it.
        const nums = Array.from({ length: this.totalCells }, (_, i) => i + 1);
        for (let i = nums.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [nums[i], nums[j]] = [nums[j], nums[i]];
        }

        const board = document.getElementById('schulte-board');
        board.innerHTML = '';
        // The center cell index in a 1-D array for an N×N grid is floor(N²/2).
        // This cell gets the 'center-marker' class as the peripheral vision
        // fixation point — the user should keep their eyes here and click
        // numbers using only their peripheral field.
        const centerIdx = Math.floor(this.totalCells / 2);

        nums.forEach((n, i) => {
            const cell = document.createElement('div');
            cell.className = 'schulte-cell';
            cell.setAttribute('role', 'button');
            cell.setAttribute('aria-label', `Number ${n}`);
            if (i === centerIdx) cell.classList.add('center-marker'); // fixation point
            cell.textContent = n;
            cell.addEventListener('click', () => this.handleClick(cell, n));
            board.appendChild(cell);
        });
    }

    // ── Click handler ──────────────────────────────────────────────────────────
    // Core trial-response mechanism. Validates whether the clicked number
    // is the expected next target in the ascending sequence.
    //
    // Correct click: marks cell green, disables it, advances sequence.
    //   → If the final number was just clicked: records table completion
    //     time (key clinical metric), updates bestTime, then either
    //     auto-advances to the next table (600 ms inter-table interval)
    //     or ends the session when the table goal is reached.
    // Wrong click: marks cell red briefly (300 ms visual feedback),
    //   increments error counter. Errors are clinically relevant —
    //   elevated errors may indicate impulsive responding or difficulty
    //   maintaining ordinal sequence tracking under visual load.
    handleClick(cell, num) {
        if (num === this.next) {
            cell.classList.add('correct');
            cell.style.pointerEvents = 'none'; // prevent double-clicking a found cell
            this.next++;
            this.app.audio.playCorrect();
            this.app.audio.haptic(25);
            document.getElementById('schulte-next').textContent = this.next <= this.totalCells ? this.next : '--';

            if (this.next > this.totalCells) {
                // All numbers found — table complete.
                this.tablesCompleted++;
                const elapsed = (performance.now() - this.tableStart) / 1000; // seconds
                if (elapsed < this.bestTime) this.bestTime = elapsed; // update best
                document.getElementById('schulte-best').textContent = this.bestTime.toFixed(1) + 's';
                document.getElementById('schulte-table-num').textContent =
                    `${Math.min(this.tablesCompleted + 1, this.tablesGoal)} / ${this.tablesGoal}`;

                if (this.tablesCompleted >= this.tablesGoal) {
                    // Session goal reached — hand control back to the app.
                    this.app.stopTimer();
                    this.app.endSession('schulte');
                } else {
                    // More tables remain; brief pause before generating the next grid.
                    setTimeout(() => this.generateBoard(), 600);
                }
            }
        } else {
            // Wrong number clicked — flash red for 300 ms, tally the error.
            cell.classList.add('wrong');
            this.errorCount++;
            this.app.audio.playWrong();
            this.app.audio.haptic([50, 30, 50]);
            document.getElementById('schulte-errors').textContent = this.errorCount;
            setTimeout(() => cell.classList.remove('wrong'), 300);
        }
    }

    // ── Results ────────────────────────────────────────────────────────────────
    // Returns the session summary in the three formats expected by the app:
    //   data        — raw numbers for storage / further analysis
    //   displayText — compact one-line string shown in the results banner
    //   summary     — multi-line HTML shown in the results panel
    //
    // Clinical interpretation notes:
    //   - bestTime: primary speed metric; compare across sessions for trends.
    //   - totalErrors: quality metric; speed-accuracy trade-off is informative.
    //   - gridSize: must be controlled when comparing across sessions (5×5 is
    //     the standard for normative comparisons).
    getResults() {
        // Guard: if no table was ever completed bestTime stays Infinity; use 999
        // as a sentinel so it serialises cleanly.
        const best = this.bestTime === Infinity ? 999 : parseFloat(this.bestTime.toFixed(1));
        const data = {
            tablesCompleted: this.tablesCompleted,
            totalErrors: this.errorCount,
            bestTime: best,
            gridSize: this.gridSize
        };
        const bestStr = best < 999 ? best.toFixed(1) + 's' : '--';
        const displayText = `${this.tablesCompleted}/${this.tablesGoal} tables (${this.gridSize}x${this.gridSize}) | ${this.errorCount} errors | Best: ${bestStr}`;
        const summary = `Tables completed: ${this.tablesCompleted}/${this.tablesGoal}<br>Grid: ${this.gridSize}\u00d7${this.gridSize}<br>Total errors: ${this.errorCount}<br>Best table time: ${bestStr}`;
        return { data, displayText, summary };
    }

    // No persistent resources to release (event listeners are on DOM cells that
    // get replaced each table, so they clean themselves up automatically).
    cleanup() { /* nothing to clean */ }
}
