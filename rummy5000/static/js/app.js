/* ══════════════════════════════════════════════
   Rummy 5000 — Main Application Controller
   ══════════════════════════════════════════════ */

import { createCardEl, createCardBack, createMeldGroup } from './cards.js';

const SUIT_SYMBOLS = {
    hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660'
};

function cardDisplayName(card) {
    if (!card) return '?';
    if (card.is_joker) return 'Joker';
    const sym = SUIT_SYMBOLS[card.suit] || card.suit;
    return `${card.rank}${sym}`;
}

class App {
    constructor() {
        this.state = null;
        this.selectedCards = new Set();
        this.difficulty = 'medium';
        this.targetScore = 5000;
        this._meldClickAbort = null; // AbortController for meld selection listeners
        this._handRendered = false;  // track if initial deal animation done

        this._zoomLevel = 1.0;

        this._bindNavigation();
        this._bindSetup();
        this._bindGameActions();
        this._bindProfiles();
        this._bindZoom();

        this._checkActiveProfile();
    }

    // ── API helpers ───────────────────────────────────

    async _api(url, method = 'GET', body = null) {
        const opts = { method, headers: {} };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch('/rummy5000' + url, opts);
        const data = await res.json();
        if (!res.ok) {
            this._showStatus(data.error || 'An error occurred', true);
            return null;
        }
        return data;
    }

    // ── Screen management ─────────────────────────────

    _showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(`screen-${id}`).classList.add('active');
        // Hide overlays when leaving game screen
        if (id !== 'game') {
            document.getElementById('round-overlay').style.display = 'none';
            document.getElementById('gameover-overlay').style.display = 'none';
        }
    }

    // ── Profile management ────────────────────────────

    _bindProfiles() {
        document.getElementById('btn-create-profile').addEventListener('click', () => this._createProfile());
        document.getElementById('profile-name-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') this._createProfile();
        });
        document.getElementById('btn-guest').addEventListener('click', () => this._selectGuest());
        document.getElementById('btn-switch-profile').addEventListener('click', () => {
            this._loadProfiles();
            this._showScreen('profile');
        });
    }

    async _checkActiveProfile() {
        const profile = await this._api('/api/profiles/active');
        if (profile && profile.name && profile.name !== 'Guest') {
            document.getElementById('menu-player-name').textContent = profile.name;
            await this._checkResume();
            this._showScreen('menu');
        } else {
            this._loadProfiles();
        }
    }

    async _loadProfiles() {
        const profiles = await this._api('/api/profiles');
        const list = document.getElementById('profile-list');
        list.innerHTML = '';
        if (profiles) {
            profiles.forEach(p => {
                const div = document.createElement('div');
                div.className = 'profile-item';
                div.textContent = p.name;
                div.addEventListener('click', () => this._selectProfile(p.id, p.name));
                list.appendChild(div);
            });
        }
    }

    async _createProfile() {
        const input = document.getElementById('profile-name-input');
        const name = input.value.trim();
        if (!name) return;
        const result = await this._api('/api/profiles', 'POST', { name });
        if (result) {
            input.value = '';
            this._selectProfile(result.id, result.name);
        }
    }

    async _selectProfile(id, name) {
        await this._api(`/api/profiles/${id}/select`, 'POST');
        document.getElementById('menu-player-name').textContent = name;
        await this._checkResume();
        this._showScreen('menu');
    }

    async _selectGuest() {
        await this._api('/api/profiles/guest', 'POST');
        document.getElementById('menu-player-name').textContent = 'Guest';
        document.getElementById('btn-resume').style.display = 'none';
        this._showScreen('menu');
    }

    async _checkResume() {
        const data = await this._api('/api/game/has-save');
        const btn = document.getElementById('btn-resume');
        btn.style.display = (data && data.has_save) ? 'block' : 'none';
    }

    // ── Navigation ────────────────────────────────────

    _bindNavigation() {
        document.getElementById('btn-new-game').addEventListener('click', () => this._showScreen('setup'));
        document.getElementById('btn-resume').addEventListener('click', () => this._resumeGame());
        document.getElementById('btn-setup-back').addEventListener('click', () => this._showScreen('menu'));
        document.getElementById('btn-history').addEventListener('click', () => this._showHistory());
        document.getElementById('btn-history-back').addEventListener('click', () => this._showScreen('menu'));
        document.getElementById('btn-stats').addEventListener('click', () => this._showStats());
        document.getElementById('btn-stats-back').addEventListener('click', () => this._showScreen('menu'));
        document.getElementById('btn-rules').addEventListener('click', () => this._showScreen('rules'));
        document.getElementById('btn-rules-back').addEventListener('click', () => this._showScreen('menu'));
        document.getElementById('btn-quit').addEventListener('click', () => this._showScreen('menu'));
    }

    // ── Zoom ─────────────────────────────────────────

    _bindZoom() {
        document.getElementById('btn-zoom-in').addEventListener('click', () => this._setZoom(this._zoomLevel + 0.15));
        document.getElementById('btn-zoom-out').addEventListener('click', () => this._setZoom(this._zoomLevel - 0.15));
        document.getElementById('btn-zoom-reset').addEventListener('click', () => this._setZoom(1.0));
    }

    _setZoom(level) {
        this._zoomLevel = Math.max(0.5, Math.min(2.0, level));
        const root = document.documentElement;
        const base = { w: 60, h: 84, rank: 0.75, suitSm: 0.65, center: 1.6 };
        root.style.setProperty('--card-w', `${base.w * this._zoomLevel}px`);
        root.style.setProperty('--card-h', `${base.h * this._zoomLevel}px`);
        root.style.setProperty('--card-rank-size', `${base.rank * this._zoomLevel}rem`);
        root.style.setProperty('--card-suit-sm-size', `${base.suitSm * this._zoomLevel}rem`);
        root.style.setProperty('--card-center-size', `${base.center * this._zoomLevel}rem`);
        document.querySelector('.zoom-label').textContent = `${Math.round(this._zoomLevel * 100)}%`;
    }

    // ── Game setup ────────────────────────────────────

    _bindSetup() {
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.difficulty = btn.dataset.diff;
            });
        });
        document.querySelectorAll('.target-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.target-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.targetScore = parseInt(btn.dataset.target);
            });
        });
        document.getElementById('btn-start-game').addEventListener('click', () => this._startGame());
    }

    async _startGame() {
        const data = await this._api('/api/game/new', 'POST', {
            difficulty: this.difficulty,
            target_score: this.targetScore,
        });
        if (data) {
            this.state = data;
            this.selectedCards.clear();
            this._handRendered = false;
            this._showScreen('game');
            this._render();
        }
    }

    async _resumeGame() {
        const data = await this._api('/api/game/resume', 'POST');
        if (data) {
            this.state = data;
            this.selectedCards.clear();
            this._handRendered = true; // skip deal animation on resume
            this._showScreen('game');
            this._render();
        }
    }

    // ── Game actions ──────────────────────────────────

    _bindGameActions() {
        document.getElementById('draw-pile-card').addEventListener('click', () => this._drawFromPile());
        document.getElementById('btn-meld').addEventListener('click', () => this._meld());
        document.getElementById('btn-layoff').addEventListener('click', () => this._layoff());
        document.getElementById('btn-discard').addEventListener('click', () => this._discard());
        document.getElementById('btn-sort-rank').addEventListener('click', () => this._sort('rank'));
        document.getElementById('btn-sort-suit').addEventListener('click', () => this._sort('suit'));
        document.getElementById('btn-hint').addEventListener('click', () => this._getHint());
        document.getElementById('btn-save').addEventListener('click', () => this._saveGame());
        document.getElementById('btn-next-round').addEventListener('click', () => this._nextRound());
        document.getElementById('btn-play-again').addEventListener('click', () => this._startGame());
        document.getElementById('btn-gameover-menu').addEventListener('click', () => this._showScreen('menu'));
    }

    async _drawFromPile() {
        if (!this.state || this.state.phase !== 'player_draw') return;
        const data = await this._api('/api/game/draw', 'POST');
        if (data) {
            this.state = data;
            this.selectedCards.clear();
            this._handRendered = true;
            this._render();
            this._checkRoundEnd();
        }
    }

    async _pickupFromDiscard(cardIndex) {
        if (!this.state || this.state.phase !== 'player_draw') return;
        const data = await this._api('/api/game/pickup', 'POST', { card_index: cardIndex });
        if (data) {
            this.state = data;
            this.selectedCards.clear();
            this._handRendered = true;
            this._render();
        }
    }

    async _meld() {
        if (this.selectedCards.size < 3) {
            this._showStatus('Select at least 3 cards to meld.', true);
            return;
        }
        const data = await this._api('/api/game/meld', 'POST', {
            card_ids: [...this.selectedCards],
        });
        if (data) {
            this.state = data;
            this.selectedCards.clear();
            this._render();
            this._checkRoundEnd();
        }
    }

    async _layoff() {
        if (this.selectedCards.size !== 1) {
            this._showStatus('Select exactly 1 card to lay off.', true);
            return;
        }
        this._showStatus('Click on a meld to lay off the selected card.');
        this._enableMeldSelection();
    }

    _enableMeldSelection() {
        // Cancel any previous meld selection
        this._disableMeldSelection();

        const abort = new AbortController();
        this._meldClickAbort = abort;

        document.querySelectorAll('.meld-group').forEach(group => {
            group.classList.add('highlight');
            group.addEventListener('click', async () => {
                const meldIndex = parseInt(group.dataset.meldIndex);
                const cardId = [...this.selectedCards][0];
                const data = await this._api('/api/game/layoff', 'POST', {
                    card_id: cardId,
                    meld_index: meldIndex,
                });
                if (data) {
                    this.state = data;
                    this.selectedCards.clear();
                    this._render();
                    this._checkRoundEnd();
                }
                this._disableMeldSelection();
            }, { signal: abort.signal });
        });
    }

    _disableMeldSelection() {
        if (this._meldClickAbort) {
            this._meldClickAbort.abort();
            this._meldClickAbort = null;
        }
        document.querySelectorAll('.meld-group').forEach(group => {
            group.classList.remove('highlight');
        });
    }

    async _discard() {
        if (this.selectedCards.size !== 1) {
            this._showStatus('Select exactly 1 card to discard.', true);
            return;
        }
        const cardId = [...this.selectedCards][0];
        const data = await this._api('/api/game/discard', 'POST', { card_id: cardId });
        if (data) {
            this.state = data;
            this.selectedCards.clear();
            this._handRendered = false; // animate new round deal

            if (data.ai_actions && data.ai_actions.length > 0) {
                await this._animateAITurn(data.ai_actions);
            }

            this._render();
            this._checkRoundEnd();
        }
    }

    async _sort(by) {
        const data = await this._api('/api/game/sort', 'POST', { by });
        if (data) { this.state = data; this._render(); }
    }

    async _getHint() {
        const hint = await this._api('/api/game/hint');
        if (hint) {
            this._showStatus(hint.message);
            if (hint.cards) {
                this.selectedCards = new Set(hint.cards);
                this._updateHandSelection();
                this._updateActions();
            }
        }
    }

    async _saveGame() {
        const data = await this._api('/api/game/save', 'POST');
        if (data) this._showStatus('Game saved!');
    }

    async _nextRound() {
        document.getElementById('round-overlay').style.display = 'none';
        const data = await this._api('/api/game/next-round', 'POST');
        if (data) {
            this.state = data;
            this.selectedCards.clear();
            this._handRendered = false;
            this._render();
        }
    }

    // ── Rendering ─────────────────────────────────────

    _render() {
        if (!this.state) return;

        // Score banner
        document.getElementById('round-num').textContent = this.state.round_number;
        document.getElementById('player-score').textContent = this.state.player.total_score.toLocaleString();
        document.getElementById('ai-score').textContent = this.state.ai.total_score.toLocaleString();
        document.getElementById('target-score').textContent = this.state.target_score.toLocaleString();

        // Draw pile
        document.getElementById('draw-count').textContent = this.state.draw_pile_count;
        const drawPile = document.getElementById('draw-pile');
        drawPile.classList.toggle('glow', this.state.phase === 'player_draw');

        this._renderAIHand();
        this._renderDiscardPile();
        this._renderMelds();
        this._renderHand();
        this._updateActions();
        this._updateStatus();
    }

    _renderAIHand() {
        const container = document.getElementById('ai-hand');
        container.innerHTML = '';
        for (let i = 0; i < this.state.ai.hand_count; i++) {
            container.appendChild(createCardBack({ small: true }));
        }
    }

    _renderDiscardPile() {
        const container = document.getElementById('discard-pile');
        container.innerHTML = '<span class="pile-label">Discard</span>';
        const pile = this.state.discard_pile;
        const visible = pile.slice(Math.max(0, pile.length - 8));
        const startIndex = Math.max(0, pile.length - 8);
        visible.forEach((card, i) => {
            const el = createCardEl(card);
            el.dataset.discardIndex = startIndex + i;
            if (this.state.phase === 'player_draw') {
                el.addEventListener('click', () => this._pickupFromDiscard(startIndex + i));
            }
            container.appendChild(el);
        });
    }

    _renderMelds() {
        const playerMelds = document.getElementById('player-melds');
        playerMelds.innerHTML = '<span class="meld-label">Your Melds</span>';
        this.state.player.melds.forEach((meld, i) => {
            playerMelds.appendChild(createMeldGroup(meld, { meldIndex: i }));
        });

        const aiMelds = document.getElementById('ai-melds');
        aiMelds.innerHTML = '<span class="meld-label">AI Melds</span>';
        const offset = this.state.player.melds.length;
        this.state.ai.melds.forEach((meld, i) => {
            aiMelds.appendChild(createMeldGroup(meld, { meldIndex: offset + i }));
        });
    }

    _renderHand() {
        const container = document.getElementById('player-hand');
        container.innerHTML = '';
        const animate = !this._handRendered;

        this.state.player.hand.forEach((card, i) => {
            const el = createCardEl(card);
            if (animate) {
                el.classList.add('card-deal');
                el.style.animationDelay = `${i * 0.05}s`;
            }
            if (this.selectedCards.has(card.id)) {
                el.classList.add('selected');
            }
            el.addEventListener('click', () => this._toggleCard(card.id));

            // Drag-to-reorder
            el.draggable = true;
            el.dataset.handIndex = i;
            el.addEventListener('dragstart', (e) => {
                this._dragIndex = i;
                el.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            el.addEventListener('dragend', () => {
                el.classList.remove('dragging');
                this._dragIndex = null;
                container.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over-left', 'drag-over-right'));
            });
            el.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (this._dragIndex === null || this._dragIndex === i) return;
                container.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over-left', 'drag-over-right'));
                el.classList.add(this._dragIndex < i ? 'drag-over-right' : 'drag-over-left');
            });
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                if (this._dragIndex === null || this._dragIndex === i) return;
                const hand = this.state.player.hand;
                const [moved] = hand.splice(this._dragIndex, 1);
                hand.splice(i, 0, moved);
                this._dragIndex = null;
                this._renderHand();
                this._updateActions();
            });

            container.appendChild(el);
        });

        this._handRendered = true;
    }

    /** Update selection visuals without re-creating all card DOM elements. */
    _updateHandSelection() {
        const container = document.getElementById('player-hand');
        container.querySelectorAll('.card').forEach(el => {
            const id = el.dataset.cardId;
            el.classList.toggle('selected', this.selectedCards.has(id));
        });
    }

    _toggleCard(cardId) {
        // Allow selection during meld/discard phase
        if (this.state.phase !== 'player_meld_or_discard') return;

        if (this.selectedCards.has(cardId)) {
            this.selectedCards.delete(cardId);
        } else {
            this.selectedCards.add(cardId);
        }
        this._updateHandSelection();
        this._updateActions();
    }

    _updateActions() {
        const valid = this.state.valid_actions || [];
        document.getElementById('btn-meld').disabled = !valid.includes('meld') || this.selectedCards.size < 3;
        document.getElementById('btn-layoff').disabled = !valid.includes('layoff') || this.selectedCards.size !== 1;
        document.getElementById('btn-discard').disabled = !valid.includes('discard') || this.selectedCards.size !== 1;
    }

    _updateStatus() {
        const phase = this.state.phase;
        const mustMeld = this.state.must_meld;
        let msg = '';

        if (phase === 'player_draw') {
            msg = 'Draw a card from the pile or pick up from the discard.';
        } else if (phase === 'player_meld_or_discard') {
            if (mustMeld) {
                msg = 'You must meld the card you picked up before discarding.';
            } else if (this.selectedCards.size === 0) {
                msg = 'Select cards to meld, lay off, or discard.';
            } else {
                msg = `${this.selectedCards.size} card${this.selectedCards.size > 1 ? 's' : ''} selected.`;
            }
        } else if (phase === 'ai_turn') {
            msg = 'AI is thinking...';
        } else if (phase === 'round_end') {
            msg = 'Round complete!';
        } else if (phase === 'game_over') {
            msg = 'Game over!';
        }

        this._showStatus(msg);
    }

    _showStatus(msg, isError = false) {
        const bar = document.getElementById('status-bar');
        bar.textContent = msg;
        bar.style.color = isError ? 'var(--red)' : 'var(--gold)';
        if (isError) {
            setTimeout(() => { bar.style.color = 'var(--gold)'; }, 2000);
        }
    }

    // ── AI turn animation ─────────────────────────────

    async _animateAITurn(actions) {
        this._showStatus('AI is playing...');
        for (const action of actions) {
            await this._sleep(600);
            if (action.type === 'draw') {
                this._showStatus(action.source === 'draw_pile'
                    ? 'AI draws from pile.'
                    : 'AI picks up from discard.');
            } else if (action.type === 'meld') {
                this._showStatus('AI melds cards!');
            } else if (action.type === 'layoff') {
                this._showStatus('AI lays off a card.');
            } else if (action.type === 'discard') {
                if (action.card) {
                    this._showStatus(`AI discards ${cardDisplayName(action.card)}.`);
                }
            }
        }
        await this._sleep(400);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ── Round / game end ──────────────────────────────

    _checkRoundEnd() {
        if (!this.state) return;
        if (this.state.phase === 'round_end') {
            this._showRoundSummary();
        } else if (this.state.phase === 'game_over' || this.state.game_over) {
            this._showGameOver();
        }
    }

    _showRoundSummary() {
        // Ensure game-over overlay is hidden
        document.getElementById('gameover-overlay').style.display = 'none';

        const history = this.state.round_history;
        if (!history || history.length === 0) return;
        const latest = history[history.length - 1];

        document.getElementById('round-scores').innerHTML = `
            <div class="round-score-col you">
                <h3>You</h3>
                <div class="score-line"><span>Melds</span><span>+${latest.player.meld_points}</span></div>
                <div class="score-line"><span>Hand penalty</span><span>-${latest.player.hand_penalty}</span></div>
                <div class="score-line net"><span>Round</span><span>${latest.player.net >= 0 ? '+' : ''}${latest.player.net}</span></div>
                <div class="score-line total"><span>Total</span><span>${latest.player_total.toLocaleString()}</span></div>
            </div>
            <div class="round-score-col ai">
                <h3>AI</h3>
                <div class="score-line"><span>Melds</span><span>+${latest.ai.meld_points}</span></div>
                <div class="score-line"><span>Hand penalty</span><span>-${latest.ai.hand_penalty}</span></div>
                <div class="score-line net"><span>Round</span><span>${latest.ai.net >= 0 ? '+' : ''}${latest.ai.net}</span></div>
                <div class="score-line total"><span>Total</span><span>${latest.ai_total.toLocaleString()}</span></div>
            </div>
        `;

        const wentOut = latest.went_out;
        let title = 'Round Complete';
        if (wentOut === 'player') title = 'You went out!';
        else if (wentOut === 'ai') title = 'AI went out!';
        else title = 'Draw pile exhausted';
        document.getElementById('round-title').textContent = title;
        document.getElementById('round-overlay').style.display = 'flex';
    }

    _showGameOver() {
        document.getElementById('round-overlay').style.display = 'none';

        const winner = this.state.winner;
        document.getElementById('gameover-title').textContent = winner === 'player' ? 'You Win!' : 'AI Wins!';

        document.getElementById('gameover-details').innerHTML = `
            <p style="font-size:1.2rem;margin-bottom:1rem;">
                Final Score: <strong style="color:var(--accent)">${this.state.player.total_score.toLocaleString()}</strong>
                vs
                <strong style="color:var(--red)">${this.state.ai.total_score.toLocaleString()}</strong>
            </p>
            <p style="color:var(--text-dim)">Rounds played: ${this.state.round_number}</p>
        `;

        document.getElementById('gameover-overlay').style.display = 'flex';
    }

    // ── History ───────────────────────────────────────

    async _showHistory() {
        this._showScreen('history');
        const data = await this._api('/api/history');
        const list = document.getElementById('history-list');
        list.innerHTML = '';

        if (!data || data.length === 0) {
            list.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:2rem;">No games played yet.</p>';
            return;
        }

        data.forEach(game => {
            const div = document.createElement('div');
            div.className = 'history-entry';
            const date = new Date(game.started_at).toLocaleDateString();
            div.innerHTML = `
                <div>
                    <span class="result ${game.result}">${game.result === 'win' ? 'WIN' : 'LOSS'}</span>
                    <span style="margin-left:8px;">${game.player_score.toLocaleString()} - ${game.ai_score.toLocaleString()}</span>
                </div>
                <div>
                    <span style="text-transform:capitalize;">${game.difficulty}</span>
                    <span class="history-meta" style="margin-left:8px;">${game.rounds_played} rounds</span>
                    <span class="history-meta" style="margin-left:8px;">${date}</span>
                </div>
            `;
            list.appendChild(div);
        });
    }

    // ── Stats ─────────────────────────────────────────

    async _showStats() {
        this._showScreen('stats');
        const data = await this._api('/api/stats');
        const content = document.getElementById('stats-content');

        if (!data || data.error) {
            content.innerHTML = '<p style="color:var(--text-dim);text-align:center;">Select a profile to view stats.</p>';
            return;
        }

        content.innerHTML = `
            <div class="stat-card">
                <h3>Overall</h3>
                <div class="stat-row"><span>Games Played</span><span class="stat-value">${data.total_games}</span></div>
                <div class="stat-row"><span>Wins</span><span class="stat-value" style="color:var(--green)">${data.wins}</span></div>
                <div class="stat-row"><span>Losses</span><span class="stat-value" style="color:var(--red)">${data.losses}</span></div>
                <div class="stat-row"><span>Win Rate</span><span class="stat-value">${data.win_rate}%</span></div>
            </div>
            <div class="stat-card">
                <h3>Records</h3>
                <div class="stat-row"><span>Best Game Score</span><span class="stat-value" style="color:var(--gold)">${data.best_game_score.toLocaleString()}</span></div>
                <div class="stat-row"><span>Best Round Score</span><span class="stat-value">${data.best_round_score.toLocaleString()}</span></div>
                <div class="stat-row"><span>Avg Round Score</span><span class="stat-value">${data.avg_round_score}</span></div>
            </div>
            <div class="stat-card">
                <h3>Streaks</h3>
                <div class="stat-row"><span>Current Win Streak</span><span class="stat-value">${data.current_streak}</span></div>
                <div class="stat-row"><span>Best Win Streak</span><span class="stat-value" style="color:var(--gold)">${data.best_streak}</span></div>
            </div>
            <div class="stat-card">
                <h3>By Difficulty</h3>
                ${Object.entries(data.by_difficulty).map(([diff, s]) => `
                    <div class="stat-row">
                        <span style="text-transform:capitalize">${diff}</span>
                        <span class="stat-value">${s.wins}/${s.played} (${s.win_rate}%)</span>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

// Boot
const app = new App();
