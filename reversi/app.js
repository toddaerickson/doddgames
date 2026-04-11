/* ==============================================================
   Reversi (Othello) — Game Engine + AI + UI Controller
   ==============================================================
   Pure client-side implementation. AI uses minimax with
   alpha-beta pruning and a positional + mobility heuristic.
   ============================================================== */

// ── Constants ────────────────────────────────────────

const EMPTY = 0, BLACK = 1, WHITE = 2;
const SIZE = 8;
const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

// Positional weights — corners are extremely valuable, edges are good,
// squares adjacent to corners (X-squares and C-squares) are dangerous
const WEIGHTS = [
    [100, -20,  10,  8,  8, 10, -20, 100],
    [-20, -40,  -5, -5, -5, -5, -40, -20],
    [ 10,  -5,   4,  2,  2,  4,  -5,  10],
    [  8,  -5,   2,  1,  1,  2,  -5,   8],
    [  8,  -5,   2,  1,  1,  2,  -5,   8],
    [ 10,  -5,   4,  2,  2,  4,  -5,  10],
    [-20, -40,  -5, -5, -5, -5, -40, -20],
    [100, -20,  10,  8,  8, 10, -20, 100],
];

// AI search depth and randomness per level (1-10)
// Lower levels add random noise to evaluation; higher levels search deeper
const LEVELS = [
    { depth: 1, noise: 60  },  // Level 1: Beginner — shallow, very noisy
    { depth: 1, noise: 30  },  // Level 2: Novice
    { depth: 2, noise: 20  },  // Level 3: Casual
    { depth: 2, noise: 10  },  // Level 4: Intermediate
    { depth: 3, noise: 5   },  // Level 5: Skilled
    { depth: 4, noise: 3   },  // Level 6: Advanced
    { depth: 4, noise: 0   },  // Level 7: Expert
    { depth: 5, noise: 0   },  // Level 8: Master
    { depth: 6, noise: 0   },  // Level 9: Grandmaster
    { depth: 7, noise: 0   },  // Level 10: Mastery — deepest search
];

// ── Board Logic ──────────────────────────────────────

function createBoard() {
    const b = Array.from({ length: SIZE }, () => new Int8Array(SIZE));
    b[3][3] = WHITE; b[3][4] = BLACK;
    b[4][3] = BLACK; b[4][4] = WHITE;
    return b;
}

function copyBoard(b) {
    return b.map(row => new Int8Array(row));
}

function opponent(color) {
    return color === BLACK ? WHITE : BLACK;
}

/** Returns list of [row, col] positions that would be flipped by placing
 *  `color` at (r, c). Empty list means the move is invalid. */
function getFlips(board, r, c, color) {
    if (board[r][c] !== EMPTY) return [];
    const opp = opponent(color);
    const flips = [];

    for (const [dr, dc] of DIRS) {
        const line = [];
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === opp) {
            line.push([nr, nc]);
            nr += dr;
            nc += dc;
        }
        if (line.length > 0 && nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === color) {
            flips.push(...line);
        }
    }
    return flips;
}

/** Returns all valid moves for `color` as [[row, col], ...]. */
function getValidMoves(board, color) {
    const moves = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (getFlips(board, r, c, color).length > 0) {
                moves.push([r, c]);
            }
        }
    }
    return moves;
}

/** Apply a move and return [newBoard, flippedPositions]. */
function applyMove(board, r, c, color) {
    const flips = getFlips(board, r, c, color);
    const nb = copyBoard(board);
    nb[r][c] = color;
    for (const [fr, fc] of flips) {
        nb[fr][fc] = color;
    }
    return [nb, flips];
}

function countDiscs(board) {
    let black = 0, white = 0;
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
            if (board[r][c] === BLACK) black++;
            else if (board[r][c] === WHITE) white++;
        }
    return { black, white };
}

function isGameOver(board) {
    return getValidMoves(board, BLACK).length === 0 &&
           getValidMoves(board, WHITE).length === 0;
}

// ── AI ───────────────────────────────────────────────

/** Evaluate the board from `color`'s perspective.
 *  Combines positional weight, disc count, mobility, and corner control. */
function evaluate(board, color) {
    const opp = opponent(color);
    let posScore = 0;
    let myDiscs = 0, oppDiscs = 0;

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (board[r][c] === color) {
                posScore += WEIGHTS[r][c];
                myDiscs++;
            } else if (board[r][c] === opp) {
                posScore -= WEIGHTS[r][c];
                oppDiscs++;
            }
        }
    }

    // Mobility: how many moves each player has
    const myMoves = getValidMoves(board, color).length;
    const oppMoves = getValidMoves(board, opp).length;
    const mobilityScore = (myMoves - oppMoves) * 10;

    // Corner control bonus
    const corners = [[0,0],[0,7],[7,0],[7,7]];
    let cornerScore = 0;
    for (const [cr, cc] of corners) {
        if (board[cr][cc] === color) cornerScore += 25;
        else if (board[cr][cc] === opp) cornerScore -= 25;
    }

    // In endgame (few empty squares), disc count matters most
    const totalDiscs = myDiscs + oppDiscs;
    if (totalDiscs > 55) {
        return (myDiscs - oppDiscs) * 10 + cornerScore;
    }

    return posScore + mobilityScore + cornerScore;
}

/** Minimax with alpha-beta pruning.
 *  `noise` adds random perturbation to leaf evaluations (makes AI weaker). */
function minimax(board, depth, alpha, beta, maximizing, aiColor, noise = 0) {
    const color = maximizing ? aiColor : opponent(aiColor);
    const moves = getValidMoves(board, color);

    if (depth === 0 || isGameOver(board)) {
        let score = evaluate(board, aiColor);
        if (noise > 0) score += (Math.random() - 0.5) * noise * 2;
        return { score, move: null };
    }

    // Pass: if no moves, pass turn to opponent
    if (moves.length === 0) {
        const result = minimax(board, depth - 1, alpha, beta, !maximizing, aiColor, noise);
        return { score: result.score, move: null };
    }

    // Order moves: prioritize corners and edges for better pruning
    moves.sort((a, b) => WEIGHTS[b[0]][b[1]] - WEIGHTS[a[0]][a[1]]);

    let bestMove = moves[0];

    if (maximizing) {
        let maxScore = -Infinity;
        for (const [r, c] of moves) {
            const [nb] = applyMove(board, r, c, color);
            const { score } = minimax(nb, depth - 1, alpha, beta, false, aiColor, noise);
            if (score > maxScore) {
                maxScore = score;
                bestMove = [r, c];
            }
            alpha = Math.max(alpha, score);
            if (beta <= alpha) break;
        }
        return { score: maxScore, move: bestMove };
    } else {
        let minScore = Infinity;
        for (const [r, c] of moves) {
            const [nb] = applyMove(board, r, c, color);
            const { score } = minimax(nb, depth - 1, alpha, beta, true, aiColor, noise);
            if (score < minScore) {
                minScore = score;
                bestMove = [r, c];
            }
            beta = Math.min(beta, score);
            if (beta <= alpha) break;
        }
        return { score: minScore, move: bestMove };
    }
}

function aiChooseMove(board, aiColor, level) {
    const config = LEVELS[level - 1] || LEVELS[5];
    const { move } = minimax(board, config.depth, -Infinity, Infinity, true, aiColor, config.noise);
    return move;
}

// ── UI Controller ────────────────────────────────────

class ReversiApp {
    constructor() {
        this.board = null;
        this.playerColor = BLACK;
        this.aiColor = WHITE;
        this.currentTurn = BLACK;   // black always goes first
        this.level = 5;  // 1-10
        this.history = [];          // stack of { board, turn, lastMove } for undo
        this.lastMove = null;
        this.gameActive = false;
        this.aiThinking = false;

        this._bindMenu();
        this._bindGame();
    }

    // ── Menu ─────────────────────────────────────

    _bindMenu() {
        // Level slider
        const slider = document.getElementById('level-slider');
        const numberEl = document.getElementById('level-number');
        const labelEl = document.getElementById('level-label');
        if (slider) {
            slider.addEventListener('input', () => {
                this.level = parseInt(slider.value);
                numberEl.textContent = this.level;
                labelEl.textContent = this._levelName(this.level);
            });
        }

        // Color picker
        document.querySelectorAll('#color-picker .color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#color-picker .color-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });

        // Play button
        document.getElementById('btn-play').addEventListener('click', () => {
            const colorBtn = document.querySelector('#color-picker .color-btn.selected');
            this.playerColor = colorBtn.dataset.color === 'black' ? BLACK : WHITE;
            this.aiColor = opponent(this.playerColor);
            this._startGame();
        });
    }

    _bindGame() {
        document.getElementById('btn-hint').addEventListener('click', () => this._showHint());
        document.getElementById('btn-undo').addEventListener('click', () => this._undo());
        document.getElementById('btn-new').addEventListener('click', () => this._startGame());
        document.getElementById('btn-quit').addEventListener('click', () => this._showScreen('menu'));
        document.getElementById('btn-rematch').addEventListener('click', () => {
            document.getElementById('overlay-gameover').classList.remove('active');
            this._startGame();
        });
        document.getElementById('btn-go-menu').addEventListener('click', () => {
            document.getElementById('overlay-gameover').classList.remove('active');
            this._showScreen('menu');
        });
    }

    _levelName(n) {
        const names = ['','Beginner','Novice','Casual','Intermediate','Skilled',
                       'Advanced','Expert','Master','Grandmaster','Mastery'];
        return names[n] || `Level ${n}`;
    }

    _showScreen(name) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(`screen-${name}`).classList.add('active');
    }

    // ── Game Flow ────────────────────────────────

    _startGame() {
        this.board = createBoard();
        this.currentTurn = BLACK;
        this.history = [];
        this.lastMove = null;
        this.gameActive = true;
        this.aiThinking = false;

        this._hideHintBar();
        this._showScreen('game');
        this._render();

        // If AI goes first (player chose white), trigger AI move
        if (this.playerColor === WHITE) {
            this._aiTurn();
        }
    }

    _hideHintBar() {
        const hintBar = document.getElementById('hint-bar');
        if (hintBar) hintBar.style.display = 'none';
        clearTimeout(this._hintTimeout);
    }

    _handleCellClick(r, c) {
        if (!this.gameActive || this.aiThinking) return;
        if (this.currentTurn !== this.playerColor) return;

        const flips = getFlips(this.board, r, c, this.playerColor);
        if (flips.length === 0) return;

        this._hideHintBar();

        // Save state for undo
        this.history.push({
            board: copyBoard(this.board),
            turn: this.currentTurn,
            lastMove: this.lastMove,
        });

        // Apply move
        const [newBoard] = applyMove(this.board, r, c, this.playerColor);
        this.board = newBoard;
        this.lastMove = [r, c];

        this._advanceTurn();
    }

    _advanceTurn() {
        const next = opponent(this.currentTurn);

        if (isGameOver(this.board)) {
            this.currentTurn = next;
            this._render();
            this._endGame();
            return;
        }

        // Check if next player has moves
        if (getValidMoves(this.board, next).length > 0) {
            this.currentTurn = next;
        } else {
            // Next player must pass — current player goes again
            // (currentTurn stays the same)
        }

        this._render();

        if (this.currentTurn === this.aiColor && this.gameActive) {
            this._aiTurn();
        }
    }

    _aiTurn() {
        this.aiThinking = true;
        this._updateTurnIndicator();

        // Delay so UI updates before blocking compute
        setTimeout(() => {
            const move = aiChooseMove(this.board, this.aiColor, this.level);
            if (!move) {
                // AI must pass
                this.currentTurn = this.playerColor;
                this.aiThinking = false;
                this._render();
                if (isGameOver(this.board)) this._endGame();
                return;
            }

            // Save state for undo (include AI move so player can undo back)
            this.history.push({
                board: copyBoard(this.board),
                turn: this.currentTurn,
                lastMove: this.lastMove,
            });

            const [r, c] = move;
            const [newBoard] = applyMove(this.board, r, c, this.aiColor);
            this.board = newBoard;
            this.lastMove = [r, c];
            this.aiThinking = false;

            this._advanceTurn();
        }, 150);
    }

    _endGame() {
        this.gameActive = false;
        const { black, white } = countDiscs(this.board);

        document.getElementById('go-black').textContent = black;
        document.getElementById('go-white').textContent = white;

        const playerCount = this.playerColor === BLACK ? black : white;
        const aiCount = this.playerColor === BLACK ? white : black;

        let result;
        const titleEl = document.getElementById('gameover-title');
        const msgEl = document.getElementById('gameover-message');

        if (playerCount > aiCount) {
            result = 'win';
            titleEl.textContent = 'You Win!';
            titleEl.style.color = 'var(--gold)';
            msgEl.textContent = `You dominated the board ${playerCount} to ${aiCount}.`;
        } else if (aiCount > playerCount) {
            result = 'loss';
            titleEl.textContent = 'AI Wins';
            titleEl.style.color = '#e74c3c';
            msgEl.textContent = `The AI outplayed you ${aiCount} to ${playerCount}.`;
        } else {
            result = 'draw';
            titleEl.textContent = 'Draw!';
            titleEl.style.color = 'var(--accent)';
            msgEl.textContent = `A perfectly balanced game — ${playerCount} to ${aiCount}.`;
        }

        // Save score to server (fire-and-forget)
        const levelName = this._levelName(this.level);
        const resultLabel = result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Draw';
        fetch('/api/scores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game: 'reversi',
                data: {
                    level: this.level,
                    levelName,
                    playerDiscs: playerCount,
                    aiDiscs: aiCount,
                    result,
                    playerColor: this.playerColor === BLACK ? 'black' : 'white',
                },
                displayText: `Lvl ${this.level} ${levelName} — ${resultLabel} ${playerCount}-${aiCount}`,
            }),
        }).catch(() => {});

        document.getElementById('overlay-gameover').classList.add('active');
    }

    _showHint() {
        if (!this.gameActive || this.aiThinking || this.currentTurn !== this.playerColor) return;

        // Use AI at level 6 to suggest a good move
        const move = aiChooseMove(this.board, this.playerColor, 6);
        if (!move) return;

        const [r, c] = move;
        const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
        if (cell) {
            cell.classList.add('hint-cell');
            setTimeout(() => cell.classList.remove('hint-cell'), 4000);
        }

        // Show explanation
        const explanation = this._explainMove(r, c);
        const hintBar = document.getElementById('hint-bar');
        hintBar.innerHTML = explanation;
        hintBar.style.display = 'block';
        // Auto-hide after 8 seconds
        clearTimeout(this._hintTimeout);
        this._hintTimeout = setTimeout(() => { hintBar.style.display = 'none'; }, 8000);
    }

    /** Analyze a move and return an HTML explanation of why it's good. */
    _explainMove(r, c) {
        const flips = getFlips(this.board, r, c, this.playerColor);
        const colLabels = 'ABCDEFGH';
        const pos = `${colLabels[c]}${r + 1}`;

        const reasons = [];

        // Corner
        const corners = [[0,0],[0,7],[7,0],[7,7]];
        if (corners.some(([cr,cc]) => cr === r && cc === c)) {
            reasons.push('This is a <strong>corner</strong> — the most powerful square. Corners can never be flipped.');
        }

        // Edge (not corner)
        const isEdge = (r === 0 || r === 7 || c === 0 || c === 7);
        if (isEdge && reasons.length === 0) {
            reasons.push('This is an <strong>edge square</strong> — edge discs are hard to flip and help you control a whole side.');
        }

        // Adjacent to corner (C-square or X-square) — warn if no corner taken
        const xSquares = [[1,1],[1,6],[6,1],[6,6]];
        const isXSquare = xSquares.some(([xr,xc]) => xr === r && xc === c);
        if (isXSquare) {
            // Check if the adjacent corner is already taken by player
            const adjCorner = corners.find(([cr,cc]) => Math.abs(cr-r) <= 1 && Math.abs(cc-c) <= 1);
            if (adjCorner && this.board[adjCorner[0]][adjCorner[1]] === this.playerColor) {
                reasons.push('Normally an X-square (diagonal to corner) is risky, but you already own the adjacent corner.');
            }
        }

        // Flip count
        if (flips.length >= 5) {
            reasons.push(`Flips <strong>${flips.length} discs</strong> — a big swing that shifts the board in your favor.`);
        } else if (flips.length >= 3) {
            reasons.push(`Flips <strong>${flips.length} discs</strong> in this move.`);
        }

        // Mobility analysis: does this move give us more future moves?
        const [newBoard] = applyMove(this.board, r, c, this.playerColor);
        const oppMovesBefore = getValidMoves(this.board, opponent(this.playerColor)).length;
        const oppMovesAfter = getValidMoves(newBoard, opponent(this.playerColor)).length;
        const myMovesAfter = getValidMoves(newBoard, this.playerColor).length;

        if (oppMovesAfter < oppMovesBefore && oppMovesBefore - oppMovesAfter >= 2) {
            reasons.push(`Reduces the opponent's options from ${oppMovesBefore} to <strong>${oppMovesAfter} moves</strong> — limiting their choices is key.`);
        }

        if (myMovesAfter > getValidMoves(this.board, this.playerColor).length) {
            reasons.push('Increases your own mobility — more available moves means more flexibility.');
        }

        // Stable disc detection: if placing on an edge next to own discs
        if (isEdge && !corners.some(([cr,cc]) => cr === r && cc === c)) {
            // Check if adjacent to own disc along the edge
            const edgeNeighbors = [];
            for (const [dr, dc] of DIRS) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && this.board[nr][nc] === this.playerColor) {
                    if (nr === r || nc === c) edgeNeighbors.push([nr, nc]);
                }
            }
            if (edgeNeighbors.length > 0 && reasons.length < 2) {
                reasons.push('Extends your edge presence — connected edge discs are very stable.');
            }
        }

        // Fallback
        if (reasons.length === 0) {
            reasons.push(`Flips ${flips.length} disc${flips.length !== 1 ? 's' : ''} — the AI evaluates this as the strongest positional choice.`);
        }

        return `<strong>${pos}:</strong> ${reasons.join(' ')}`;
    }

    _undo() {
        if (this.history.length === 0 || this.aiThinking) return;

        // Undo back to the player's last decision point
        // If the last history entry was an AI move, undo both AI and player moves
        let state = this.history.pop();
        if (state.turn === this.aiColor && this.history.length > 0) {
            state = this.history.pop();
        }

        this.board = state.board;
        this.currentTurn = state.turn;
        this.lastMove = state.lastMove;
        this.gameActive = true;
        document.getElementById('overlay-gameover').classList.remove('active');
        this._render();
    }

    // ── Rendering ────────────────────────────────

    _render() {
        this._renderBoard();
        this._renderScores();
        this._updateTurnIndicator();
    }

    _renderBoard() {
        const boardEl = document.getElementById('board');
        boardEl.innerHTML = '';

        const validMoves = this.gameActive && this.currentTurn === this.playerColor && !this.aiThinking
            ? getValidMoves(this.board, this.playerColor)
            : [];
        const validSet = new Set(validMoves.map(([r, c]) => `${r},${c}`));

        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.r = r;
                cell.dataset.c = c;

                if (validSet.has(`${r},${c}`)) {
                    cell.classList.add('valid');
                    cell.addEventListener('click', () => this._handleCellClick(r, c));
                }

                if (this.lastMove && this.lastMove[0] === r && this.lastMove[1] === c) {
                    cell.classList.add('last-move');
                }

                if (this.board[r][c] !== EMPTY) {
                    const disc = document.createElement('div');
                    disc.className = 'disc';

                    const inner = document.createElement('div');
                    inner.className = 'disc-inner';

                    const blackFace = document.createElement('div');
                    blackFace.className = 'disc-face disc-black';

                    const whiteFace = document.createElement('div');
                    whiteFace.className = 'disc-face disc-white';

                    inner.appendChild(blackFace);
                    inner.appendChild(whiteFace);
                    disc.appendChild(inner);

                    disc.classList.add(this.board[r][c] === BLACK ? 'black' : 'white');

                    cell.appendChild(disc);
                }

                boardEl.appendChild(cell);
            }
        }
    }

    _renderScores() {
        const { black, white } = countDiscs(this.board);
        document.getElementById('score-black').textContent = black;
        document.getElementById('score-white').textContent = white;
    }

    _updateTurnIndicator() {
        const pieceEl = document.getElementById('turn-piece');
        const textEl = document.getElementById('turn-text');
        const container = document.getElementById('turn-indicator');

        pieceEl.className = 'piece piece-sm';
        pieceEl.classList.add(this.currentTurn === BLACK ? 'piece-black' : 'piece-white');

        container.classList.remove('thinking-pulse');

        if (!this.gameActive) {
            textEl.textContent = 'Game over';
        } else if (this.aiThinking) {
            textEl.textContent = 'Thinking...';
            container.classList.add('thinking-pulse');
        } else if (this.currentTurn === this.playerColor) {
            textEl.textContent = 'Your turn';
        } else {
            textEl.textContent = 'AI turn';
        }
    }
}

// ── Init ─────────────────────────────────────────────

new ReversiApp();
