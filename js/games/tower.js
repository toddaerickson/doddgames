/* ══════════════════════════════════════════════════════════
   TOWER OF LONDON — Executive function: planning depth
   Move 3 colored discs across 3 pegs to match a goal state.

   Clinical background:
   - The Tower of London (TOL) was developed by Tim Shallice (1982)
     specifically to assess prefrontal executive function — in particular,
     multi-step planning and the ability to look ahead before acting.
   - Planning depth is the primary construct: puzzles requiring more moves
     demand deeper lookahead and working-memory maintenance of subgoals.
   - First-move latency ("planning time") is a clinically informative
     secondary metric. Short planning time coupled with excessive moves
     is a well-documented behavioral signature of impulsivity, frequently
     observed in ADHD populations. Conversely, long planning time with
     few excess moves suggests deliberate but slow executive processing,
     a pattern common in age-related cognitive decline.
   - Move efficiency (optimal vs. actual moves) captures overall planning
     accuracy and is the primary outcome variable in most TOL studies.

   Physical constraints:
   - 3 pegs with fixed capacity limits: peg0=3 discs, peg1=2, peg2=1
   - 3 discs: red (index 0, widest), green (index 1), blue (index 2, narrowest)
   - Discs are stored bottom-to-top in each peg array.
   - Note: unlike Tower of Hanoi, TOL pegs have capacity limits but no
     size-ordering rule — any disc can go on any peg with available space.

   Interaction model (click-to-select, click-to-place):
   - First click on a peg selects the top disc (highlights it).
   - Second click on a different peg moves the disc there (if capacity allows).
   - Clicking the same peg again deselects.

   Difficulty progression:
   - Puzzles are defined with known optimal move counts (2–5 moves).
   - Puzzles are grouped by difficulty and shuffled within each group,
     so easier puzzles always come before harder ones in a session.
   - This mirrors standard clinical administration where trials progress
     from simple to complex, allowing examinees to build confidence
     before encountering cognitively demanding items.

   Clinical metrics:
   - Planning time: elapsed time from puzzle load to the user's first move.
     Short planning time paired with many excess moves indicates impulsivity.
   - Move efficiency: ratio of optimal moves to actual moves taken.
     Calculated as: 1 - (totalExcessMoves / (puzzlesSolved * 3)) × 100%

   Cleanup strategy:
   - cleanup() uses cloneNode(true) to replace each peg element with a
     structurally identical copy, which efficiently strips all attached
     event listeners without needing to track them individually.
   ══════════════════════════════════════════════════════════ */
export class TowerGame {
    constructor(app) {
        this.app = app;

        // Peg capacity limits: peg 0 holds up to 3 discs, peg 1 up to 2, peg 2 up to 1.
        // These asymmetric capacities are the defining constraint of the TOL
        // (vs. Tower of Hanoi's equal-length pegs with size-ordering rules).
        this.PEG_CAPS = [3, 2, 1];
        // Disc colors map to disc indices: 0=red (largest), 1=green, 2=blue (smallest).
        // Color-coding aids visual tracking; widths reinforce size differences.
        this.DISC_COLORS = ['#e74c3c', '#2ecc71', '#3498db'];
        this.DISC_NAMES = ['Red', 'Green', 'Blue'];

        /* Puzzle library — each entry defines:
             start:   initial peg state (arrays of disc indices, bottom-to-top)
             goal:    target peg state the user must reach
             optimal: minimum number of moves required to solve

           All puzzles start with all three discs stacked on peg 0.
           State format: [[peg0 discs bottom-to-top], [peg1], [peg2]]

           Optimal move counts (2–5) were verified by brute-force BFS over
           the full state space. The puzzle set covers a range of planning
           depths typical of clinical TOL administrations. */
        this.PUZZLES = [
            // 2-move puzzles — minimal planning demand; serves as practice/warm-up
            { start: [[2,1,0],[],[]], goal: [[2],[0,1],[]], optimal: 2 },
            { start: [[2,1,0],[],[]], goal: [[2],[1],[0]], optimal: 2 },
            // 3-move puzzles — moderate planning; requires 1 subgoal
            { start: [[2,1,0],[],[]], goal: [[2,0],[1],[]], optimal: 3 },
            { start: [[2,1,0],[],[]], goal: [[2,0],[],[1]], optimal: 3 },
            { start: [[2,1,0],[],[]], goal: [[2],[1,0],[]], optimal: 3 },
            // 4-move puzzles — requires multi-step lookahead and subgoal management
            { start: [[2,1,0],[],[]], goal: [[1],[0,2],[]], optimal: 4 },
            { start: [[2,1,0],[],[]], goal: [[0],[1,2],[]], optimal: 4 },
            { start: [[2,1,0],[],[]], goal: [[],[1,0],[2]], optimal: 4 },
            // 5-move puzzles — highest planning demand; counter-intuitive intermediate states
            { start: [[2,1,0],[],[]], goal: [[1,0],[],[2]], optimal: 5 },
            { start: [[2,1,0],[],[]], goal: [[0,2],[1],[]], optimal: 5 },
            { start: [[2,1,0],[],[]], goal: [[0],[1],[2]], optimal: 5 },
        ];

        // --- Mutable game state ---
        this.pegs = [[], [], []];       // current disc arrangement [peg0[], peg1[], peg2[]]
        this.goalState = null;          // target arrangement for current puzzle
        this.optimalMoves = 0;          // minimum moves for current puzzle
        this.moveCount = 0;             // moves taken so far on current puzzle
        this.puzzlesSolved = 0;         // cumulative puzzles solved this session
        this.totalExcessMoves = 0;      // cumulative moves beyond optimal across all puzzles
        this.puzzleIdx = 0;             // index into the shuffled puzzle queue
        this.selectedPeg = -1;          // -1 = no peg selected; 0-2 = source peg for next move
        this.firstMoveTime = 0;         // planning time for current puzzle (ms)
        this.puzzleStart = 0;           // performance.now() timestamp when puzzle was loaded
        this.planningTimes = [];        // planning times across all puzzles (ms); averaged for reporting
        this.madeFirstMove = false;     // flag to capture planning time only once per puzzle

        this._clickPeg = this._clickPeg.bind(this);
    }

    init() {
        this.puzzlesSolved = 0;
        this.totalExcessMoves = 0;
        this.planningTimes = [];

        document.getElementById('tower-solved').textContent = '0';
        document.getElementById('tower-moves').textContent = '0';
        document.getElementById('tower-optimal').textContent = '--';
        document.getElementById('tower-planning').textContent = '--';
        document.getElementById('tower-feedback').textContent = '';

        // Shuffle puzzles within difficulty groups so presentation order varies
        // each session while always progressing from easy to hard.
        this._shufflePuzzles();
        this.puzzleIdx = 0;
        this._loadPuzzle();

        // Attach click listener to each of the three peg containers
        for (let i = 0; i < 3; i++) {
            document.getElementById(`tower-peg-${i}`).addEventListener('click', () => this._clickPeg(i));
        }
    }

    cleanup() {
        // Replace each peg element with a deep clone of itself.
        // cloneNode(true) copies the DOM structure but NOT event listeners,
        // so this cleanly removes all handlers without tracking them explicitly.
        for (let i = 0; i < 3; i++) {
            const el = document.getElementById(`tower-peg-${i}`);
            el.replaceWith(el.cloneNode(true)); // remove all listeners
        }
    }

    _shufflePuzzles() {
        // Group puzzles by their optimal move count, then Fisher-Yates shuffle
        // within each group. The groups are then concatenated in ascending order,
        // ensuring difficulty ramps up (2-move → 3-move → 4-move → 5-move).
        const groups = {};
        for (const p of this.PUZZLES) {
            if (!groups[p.optimal]) groups[p.optimal] = [];
            groups[p.optimal].push(p);
        }
        this._puzzleQueue = [];
        for (const key of Object.keys(groups).sort((a, b) => a - b)) {
            const g = groups[key];
            for (let i = g.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [g[i], g[j]] = [g[j], g[i]];
            }
            this._puzzleQueue.push(...g);
        }
    }

    _loadPuzzle() {
        if (this.puzzleIdx >= this._puzzleQueue.length) {
            // All puzzles exhausted — reshuffle and restart from the beginning
            this._shufflePuzzles();
            this.puzzleIdx = 0;
        }

        const puzzle = this._puzzleQueue[this.puzzleIdx];
        // Deep-copy start/goal arrays so manipulation doesn't mutate the puzzle definition
        this.pegs = puzzle.start.map(p => [...p]);
        this.goalState = puzzle.goal.map(p => [...p]);
        this.optimalMoves = puzzle.optimal;
        this.moveCount = 0;
        this.selectedPeg = -1;
        this.madeFirstMove = false;
        this.puzzleStart = performance.now(); // start planning timer

        document.getElementById('tower-moves').textContent = '0';
        document.getElementById('tower-optimal').textContent = this.optimalMoves;
        document.getElementById('tower-feedback').textContent = '';

        this._render();
        this._renderGoal();
    }

    // Core interaction handler — implements a two-phase click-to-move model.
    // Phase 1 (no selection): clicking a peg selects its top disc.
    // Phase 2 (disc selected): clicking another peg attempts the move.
    // Move validation checks only peg capacity (no size-ordering rule in TOL).
    _clickPeg(pegIdx) {
        if (this.selectedPeg === -1) {
            // Phase 1: No peg selected yet — select this peg as the source
            if (this.pegs[pegIdx].length === 0) return; // can't select an empty peg
            this.selectedPeg = pegIdx;
            this._render();
        } else if (this.selectedPeg === pegIdx) {
            // Clicked the already-selected peg — deselect (cancel move)
            this.selectedPeg = -1;
            this._render();
        } else {
            // Phase 2: A source peg is selected — attempt to move its top disc here
            const fromPeg = this.selectedPeg;
            const toPeg = pegIdx;

            if (this.pegs[toPeg].length >= this.PEG_CAPS[toPeg]) {
                // Destination peg is at capacity — reject the move
                this.app.audio.playWrong();
                this.app.audio.haptic([50, 30, 50]);
                this.selectedPeg = -1;
                this._render();
                return;
            }

            // Record planning time on the very first move of each puzzle.
            // This measures how long the user studied the puzzle before acting,
            // distinguishing impulsive movers from deliberate planners.
            if (!this.madeFirstMove) {
                this.madeFirstMove = true;
                this.firstMoveTime = performance.now() - this.puzzleStart;
                this.planningTimes.push(this.firstMoveTime);
                const avgPlan = Math.round(this.planningTimes.reduce((a, b) => a + b, 0) / this.planningTimes.length / 1000 * 10) / 10;
                document.getElementById('tower-planning').textContent = avgPlan + 's';
            }

            // Execute the move: pop top disc from source, push onto destination
            const disc = this.pegs[fromPeg].pop();
            this.pegs[toPeg].push(disc);
            this.moveCount++;
            this.selectedPeg = -1;

            document.getElementById('tower-moves').textContent = this.moveCount;
            this.app.audio.playLock();
            this.app.audio.haptic(15);

            this._render();

            // Check if the current peg state matches the goal state exactly
            if (this._isSolved()) {
                this.puzzlesSolved++;
                // Excess moves = how many more than optimal the user took
                const excess = this.moveCount - this.optimalMoves;
                this.totalExcessMoves += Math.max(0, excess);

                document.getElementById('tower-solved').textContent = this.puzzlesSolved;
                document.getElementById('tower-feedback').textContent = excess === 0 ? 'Perfect!' : `Solved in ${this.moveCount} (optimal: ${this.optimalMoves})`;
                document.getElementById('tower-feedback').style.color = excess === 0 ? '#2ecc71' : '#f39c12';

                this.app.audio.playCorrect();

                this.puzzleIdx++;
                setTimeout(() => this._loadPuzzle(), 1000);
            }
        }
    }

    // Goal-state comparison — checks if current pegs match the target exactly.
    // Uses element-wise comparison (no shortcut via JSON.stringify for performance).
    _isSolved() {
        // Compare each peg's disc stack against the goal state element by element
        for (let i = 0; i < 3; i++) {
            if (this.pegs[i].length !== this.goalState[i].length) return false;
            for (let j = 0; j < this.pegs[i].length; j++) {
                if (this.pegs[i][j] !== this.goalState[i][j]) return false;
            }
        }
        return true;
    }

    _render() {
        // Rebuild the visual disc stack for each peg from the current state.
        // Disc widths encode size (disc 0 = widest/largest, disc 2 = narrowest/smallest).
        for (let p = 0; p < 3; p++) {
            const pegEl = document.getElementById(`tower-peg-${p}`);
            const discsEl = pegEl.querySelector('.tower-discs');
            discsEl.innerHTML = '';

            for (let d = 0; d < this.pegs[p].length; d++) {
                const discIdx = this.pegs[p][d];
                const disc = document.createElement('div');
                disc.className = 'tower-disc';
                const widths = [90, 70, 50]; // widths for discs 0,1,2 (larger index = smaller)
                disc.style.width = widths[discIdx] + 'px';
                disc.style.background = this.DISC_COLORS[discIdx];

                // Highlight the top disc of the currently selected peg
                if (p === this.selectedPeg && d === this.pegs[p].length - 1) {
                    disc.classList.add('selected');
                }

                discsEl.appendChild(disc);
            }

            // Toggle a CSS class on the peg container for visual selection feedback
            pegEl.classList.toggle('peg-selected', p === this.selectedPeg);
        }
    }

    _renderGoal() {
        // Render the goal state as a semi-transparent preview alongside the live pegs.
        // Uses the same layout logic as _render() but at reduced opacity.
        for (let p = 0; p < 3; p++) {
            const goalEl = document.getElementById(`tower-goal-${p}`);
            const discsEl = goalEl.querySelector('.tower-discs');
            discsEl.innerHTML = '';

            for (let d = 0; d < this.goalState[p].length; d++) {
                const discIdx = this.goalState[p][d];
                const disc = document.createElement('div');
                disc.className = 'tower-disc';
                const widths = [90, 70, 50];
                disc.style.width = widths[discIdx] + 'px';
                disc.style.background = this.DISC_COLORS[discIdx];
                disc.style.opacity = '0.6';
                discsEl.appendChild(disc);
            }
        }
    }

    /* Returns scored results conforming to the standard game interface.
       Key clinical outputs:
       - efficiency: percentage of moves that were optimal (100% = no wasted moves).
         This is the primary TOL outcome in most neuropsych protocols.
       - avgPlanningTime: mean first-move latency across puzzles (seconds).
         Clinicians interpret this jointly with efficiency:
           high efficiency + long planning = intact but slow executive function
           low efficiency + short planning = impulsive responding (ADHD pattern)
           low efficiency + long planning  = executive dysfunction (frontal lesion pattern) */
    getResults() {
        const avgPlanning = this.planningTimes.length > 0
            ? Math.round(this.planningTimes.reduce((a, b) => a + b, 0) / this.planningTimes.length / 100) / 10
            : 0;
        // Efficiency formula: penalizes excess moves relative to a reference of 3 excess
        // moves per puzzle (arbitrary upper bound for normalization).
        const efficiency = this.puzzlesSolved > 0
            ? Math.round((1 - this.totalExcessMoves / (this.puzzlesSolved * 3)) * 100)
            : 0;

        const data = {
            puzzlesSolved: this.puzzlesSolved,
            totalExcessMoves: this.totalExcessMoves,
            avgPlanningTime: avgPlanning,
            efficiency,
        };
        const displayText = `${this.puzzlesSolved} solved | ${this.totalExcessMoves} excess moves | Plan: ${avgPlanning}s`;
        const summary = `Puzzles solved: ${this.puzzlesSolved}<br>Excess moves: ${this.totalExcessMoves}<br>Move efficiency: ${efficiency}%<br>Avg planning time: ${avgPlanning}s<br><br><em>Short planning time + many excess moves suggests impulsivity (ADHD)<br>Long planning + few excess = careful but slow (age-related)</em>`;
        return { data, displayText, summary };
    }
}
