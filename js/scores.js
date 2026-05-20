/* ==============================================================
   SCORE MANAGER — server-side persistence via /api/scores
   ==============================================================

   All session data is stored on the server in SQLite.
   Each entry has the shape: { game_key, data, display_text, played_at }

   The local cache (_history) is loaded from the server on init and
   refreshed after each score save. The cache is capped at 200 entries.

   Entries are always stored newest-first so index 0 is the most recent.
*/
export class ScoreManager {
    constructor() {
        // Local cache — populated by loadFromServer()
        this._history = [];
        this._loaded = false;
    }

    /** Load all scores from server for the active user. */
    async loadFromServer() {
        try {
            const res = await fetch('/api/scores');
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            const data = await res.json();
            // Normalise server response to internal history format
            this._history = data.map(entry => ({
                game: entry.game_key,
                data: entry.data,
                displayText: entry.display_text || '',
                date: entry.played_at,
            }));
            this._loaded = true;
        } catch (err) {
            console.warn('Failed to load scores:', err);
            // Keep existing cache on failure rather than wiping
            if (!this._loaded) this._history = [];
            this._loaded = true;
        }
    }

    getHistory() {
        return this._history;
    }

    async saveScore(game, data, displayText) {
        try {
            const res = await fetch('/api/scores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ game, data, displayText }),
            });
            if (!res.ok) console.warn('Score save returned', res.status);
        } catch (err) {
            console.warn('Failed to save score:', err);
        }
        // Refresh local cache regardless — shows latest server state
        await this.loadFromServer();
    }

    async clearHistory() {
        try {
            const res = await fetch('/api/scores/clear', { method: 'POST' });
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            this._history = [];
        } catch (err) {
            console.warn('Failed to clear history:', err);
            // Refresh from server to show actual state
            await this.loadFromServer();
        }
        this.renderAll();
    }

    getGameHistory(game) {
        return this._history.filter(e => e.game === game);
    }

    getBest(game) {
        const entries = this.getGameHistory(game);
        if (entries.length === 0) return null;

        if (game === 'schulte') {
            const times = entries.map(e => e.data && e.data.bestTime).filter(t => t && t < 999);
            return times.length > 0 ? Math.min(...times) : null;
        } else if (game === 'tetris') {
            const scores = entries.map(e => e.data && e.data.score).filter(s => s != null);
            return scores.length > 0 ? Math.max(...scores) : null;
        } else if (game === 'stroop') {
            const accs = entries.map(e => e.data && e.data.accuracy).filter(a => a != null);
            return accs.length > 0 ? Math.max(...accs) : null;
        } else if (game === 'trails-a') {
            const times = entries.map(e => e.data && e.data.bestTime).filter(t => t && t < 999);
            return times.length > 0 ? Math.min(...times) : null;
        } else if (game === 'gonogo') {
            const accs = entries.map(e => e.data && e.data.accuracy).filter(a => a != null);
            return accs.length > 0 ? Math.max(...accs) : null;
        } else if (game === 'trails-b') {
            const times = entries.map(e => e.data && e.data.bestTime).filter(t => t && t < 999);
            return times.length > 0 ? Math.min(...times) : null;
        } else if (game === 'card-sort') {
            const cats = entries.map(e => e.data && e.data.categoriesCompleted).filter(c => c != null);
            return cats.length > 0 ? Math.max(...cats) : null;
        } else if (game === 'tower') {
            const solved = entries.map(e => e.data && e.data.puzzlesSolved).filter(s => s != null);
            return solved.length > 0 ? Math.max(...solved) : null;
        } else if (game === 'symbol-digit') {
            const scores = entries.map(e => e.data && e.data.bestRoundScore).filter(s => s != null);
            return scores.length > 0 ? Math.max(...scores) : null;
        } else if (game === 'word-list') {
            const totals = entries.map(e => e.data && e.data.totalRecalled).filter(t => t != null);
            return totals.length > 0 ? Math.max(...totals) : null;
        } else if (game === 'cpt') {
            const accs = entries.map(e => e.data && e.data.accuracy).filter(a => a != null);
            return accs.length > 0 ? Math.max(...accs) : null;
        } else if (game === 'digit-span') {
            const spans = entries.map(e => e.data && e.data.maxSpan).filter(s => s != null);
            return spans.length > 0 ? Math.max(...spans) : null;
        } else if (game === 'nback') {
            const levels = entries.map(e => e.data && e.data.maxLevel).filter(l => l != null);
            return levels.length > 0 ? Math.max(...levels) : null;
        }
        return null;
    }

    _extractMetric(game, entry) {
        if (!entry.data) return null;
        switch (game) {
            case 'schulte':
            case 'trails-a':
            case 'trails-b':
                return entry.data.bestTime < 999 ? entry.data.bestTime : null;
            case 'tetris':
                return entry.data.score;
            case 'stroop':
            case 'gonogo':
                return entry.data.accuracy;
            case 'card-sort':
                return entry.data.categoriesCompleted;
            case 'tower':
                return entry.data.puzzlesSolved;
            case 'symbol-digit':
                return entry.data.bestRoundScore;
            case 'word-list':
                return entry.data.totalRecalled;
            case 'cpt':
                return entry.data.accuracy;
            case 'digit-span':
                return entry.data.maxSpan;
            case 'nback':
                return entry.data.maxLevel;
            default:
                return null;
        }
    }

    getRollingAverage(game, n) {
        const entries = this.getGameHistory(game).slice(0, n);
        if (entries.length === 0) return null;
        const values = entries.map(e => this._extractMetric(game, e)).filter(v => v != null);
        if (values.length === 0) return null;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    getSparklineData(game, n = 20) {
        const entries = this.getGameHistory(game).slice(0, n).reverse();
        return entries.map(e => this._extractMetric(game, e) || 0);
    }

    getDayStreak() {
        const history = this.getHistory();
        if (history.length === 0) return 0;

        const days = new Set();
        history.forEach(e => {
            const d = new Date(e.date);
            days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
        });

        const sortedDays = Array.from(days).map(d => {
            const [y, m, day] = d.split('-').map(Number);
            return new Date(y, m, day);
        }).sort((a, b) => b - a);

        let streak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const oneDay = 86400000;

        for (let i = 0; i < sortedDays.length; i++) {
            const expected = new Date(today.getTime() - i * oneDay);
            expected.setHours(0, 0, 0, 0);
            const d = sortedDays[i];
            d.setHours(0, 0, 0, 0);
            if (d.getTime() === expected.getTime()) {
                streak++;
            } else if (i === 0 && (today.getTime() - d.getTime()) <= oneDay) {
                streak++;
                today.setTime(d.getTime());
            } else {
                break;
            }
        }
        return streak;
    }

    drawSparkline(canvas, data) {
        if (!canvas || data.length < 2) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const max = Math.max(...data, 1);
        const min = Math.min(...data, 0);
        const range = max - min || 1;

        ctx.beginPath();
        ctx.strokeStyle = '#7b2ff7';
        ctx.lineWidth = 1.5;
        data.forEach((v, i) => {
            const x = (i / (data.length - 1)) * (w - 4) + 2;
            const y = h - 2 - ((v - min) / range) * (h - 4);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        if (data.length > 0) {
            const last = data[data.length - 1];
            const x = w - 2;
            const y = h - 2 - ((last - min) / range) * (h - 4);
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = '#00d4ff';
            ctx.fill();
        }
    }

    drawAnalyticsSparkline(canvas, data, color = '#7b2ff7') {
        if (!canvas || data.length < 2) {
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#333';
                ctx.font = '10px sans-serif';
                ctx.fillText('Not enough data', 4, canvas.height / 2 + 3);
            }
            return;
        }
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const max = Math.max(...data, 1);
        const min = Math.min(...data, 0);
        const range = max - min || 1;

        ctx.beginPath();
        data.forEach((v, i) => {
            const x = (i / (data.length - 1)) * (w - 4) + 2;
            const y = h - 2 - ((v - min) / range) * (h - 6);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.lineTo(w - 2, h);
        ctx.lineTo(2, h);
        ctx.closePath();
        ctx.fillStyle = color + '15';
        ctx.fill();

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        data.forEach((v, i) => {
            const x = (i / (data.length - 1)) * (w - 4) + 2;
            const y = h - 2 - ((v - min) / range) * (h - 6);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        data.forEach((v, i) => {
            const x = (i / (data.length - 1)) * (w - 4) + 2;
            const y = h - 2 - ((v - min) / range) * (h - 6);
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        });
    }

    renderCardBests() {
        const ALL_GAMES = [
            { key: 'schulte', unit: 's', label: 'Best Time', format: v => v.toFixed(1) + 's' },
            { key: 'tetris', unit: '', label: 'High Score', format: v => '' + v },
            { key: 'stroop', unit: '%', label: 'Best Accuracy', format: v => v + '%' },
            { key: 'trails-a', unit: 's', label: 'Best Time', format: v => v.toFixed(1) + 's' },
            { key: 'gonogo', unit: '%', label: 'Best Accuracy', format: v => v + '%' },
            { key: 'trails-b', unit: 's', label: 'Best Time', format: v => v.toFixed(1) + 's' },
            { key: 'card-sort', unit: '', label: 'Best Categories', format: v => '' + v },
            { key: 'tower', unit: '', label: 'Most Solved', format: v => '' + v },
            { key: 'symbol-digit', unit: '', label: 'Best Round', format: v => '' + v },
            { key: 'word-list', unit: '', label: 'Best Total', format: v => '' + v },
            { key: 'cpt', unit: '%', label: 'Best Accuracy', format: v => v + '%' },
            { key: 'digit-span', unit: '', label: 'Best Span', format: v => '' + v },
            { key: 'nback', unit: '', label: 'Best Level', format: v => v + '-back' },
        ];

        ALL_GAMES.forEach(g => {
            const container = document.getElementById(`card-best-${g.key}`);
            if (!container) return;
            const best = this.getBest(g.key);
            const labelEl = container.querySelector('.best-label');
            const valueEl = container.querySelector('.best-value');
            const sparkCanvas = container.querySelector('.card-sparkline');

            labelEl.textContent = g.label + ':';
            valueEl.textContent = best != null ? g.format(best) : '--';

            const sparkData = this.getSparklineData(g.key);
            this.drawSparkline(sparkCanvas, sparkData);
        });
    }

    renderAnalytics() {
        const container = document.getElementById('analytics-row');
        container.innerHTML = '';

        const games = [
            { key: 'schulte', name: 'Schulte Table', metric: 'Avg Time', unit: 's', color: '#00d4ff', format: v => v.toFixed(1) + 's' },
            { key: 'tetris', name: 'Tetris', metric: 'Avg Score', unit: '', color: '#7b2ff7', format: v => Math.round(v) + '' },
            { key: 'stroop', name: 'Stroop', metric: 'Avg Accuracy', unit: '%', color: '#2ecc71', format: v => Math.round(v) + '%' },
            { key: 'trails-a', name: 'Trail Making A', metric: 'Avg Time', unit: 's', color: '#f39c12', format: v => v.toFixed(1) + 's' },
            { key: 'gonogo', name: 'Go/No-Go', metric: 'Avg Accuracy', unit: '%', color: '#e74c3c', format: v => Math.round(v) + '%' },
            { key: 'trails-b', name: 'Trail Making B', metric: 'Avg Time', unit: 's', color: '#e67e22', format: v => v.toFixed(1) + 's' },
            { key: 'card-sort', name: 'Card Sort', metric: 'Avg Categories', unit: '', color: '#9b59b6', format: v => v.toFixed(1) },
            { key: 'tower', name: 'Tower', metric: 'Avg Solved', unit: '', color: '#1abc9c', format: v => v.toFixed(1) },
            { key: 'symbol-digit', name: 'Symbol Digit', metric: 'Avg Best Round', unit: '', color: '#3498db', format: v => Math.round(v) + '' },
            { key: 'word-list', name: 'Word List', metric: 'Avg Total Recalled', unit: '', color: '#e91e63', format: v => Math.round(v) + '' },
            { key: 'cpt', name: 'CPT', metric: 'Avg Accuracy', unit: '%', color: '#ff9800', format: v => Math.round(v) + '%' },
            { key: 'digit-span', name: 'Digit Span', metric: 'Avg Max Span', unit: '', color: '#e040fb', format: v => v.toFixed(1) },
            { key: 'nback', name: 'N-Back', metric: 'Avg Max Level', unit: '', color: '#00bcd4', format: v => v.toFixed(1) },
        ];

        games.forEach(g => {
            const entries = this.getGameHistory(g.key);
            if (entries.length === 0) return;

            const card = document.createElement('div');
            card.className = 'analytics-card';

            const h4 = document.createElement('h4');
            h4.textContent = g.name;
            card.appendChild(h4);

            const metricsDiv = document.createElement('div');
            metricsDiv.className = 'analytics-metrics';

            const avg5 = this.getRollingAverage(g.key, 5);
            const avg20 = this.getRollingAverage(g.key, 20);
            const sessions = entries.length;

            [
                { label: 'Last 5', value: avg5 },
                { label: 'Last 20', value: avg20 },
                { label: 'Sessions', value: sessions, noUnit: true }
            ].forEach(m => {
                const metric = document.createElement('div');
                metric.className = 'analytics-metric';
                const lbl = document.createElement('div');
                lbl.className = 'am-label';
                lbl.textContent = m.label;
                const val = document.createElement('div');
                val.className = 'am-value';
                if (m.noUnit) {
                    val.textContent = m.value;
                } else {
                    val.textContent = m.value != null ? g.format(m.value) : '--';
                }
                metric.appendChild(lbl);
                metric.appendChild(val);
                metricsDiv.appendChild(metric);
            });

            card.appendChild(metricsDiv);

            const sparkCanvas = document.createElement('canvas');
            sparkCanvas.className = 'sparkline-canvas';
            sparkCanvas.width = 280;
            sparkCanvas.height = 40;
            card.appendChild(sparkCanvas);

            container.appendChild(card);

            requestAnimationFrame(() => {
                const data = this.getSparklineData(g.key);
                this.drawAnalyticsSparkline(sparkCanvas, data, g.color);
            });
        });
    }

    renderHistory() {
        const list = document.getElementById('history-list');
        const history = this.getHistory();
        list.innerHTML = '';

        if (history.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'history-empty';
            empty.textContent = 'No sessions yet. Play a game to start tracking!';
            list.appendChild(empty);
            return;
        }

        const gameNames = {
            schulte: 'Schulte', tetris: 'Tetris', stroop: 'Stroop',
            'trails-a': 'Trails A', gonogo: 'Go/No-Go',
            'trails-b': 'Trails B', 'card-sort': 'Card Sort', tower: 'Tower',
            'symbol-digit': 'Symbol Digit', 'word-list': 'Word List', cpt: 'CPT',
            'digit-span': 'Digit Span', nback: 'N-Back'
        };

        history.forEach(entry => {
            const div = document.createElement('div');
            div.className = 'history-entry';

            const gameSpan = document.createElement('span');
            gameSpan.className = 'h-game';
            gameSpan.textContent = gameNames[entry.game] || entry.game;

            const detailsSpan = document.createElement('span');
            detailsSpan.className = 'h-details';
            detailsSpan.textContent = entry.displayText || '(no details)';

            const dateSpan = document.createElement('span');
            dateSpan.className = 'h-date';
            const d = new Date(entry.date);
            dateSpan.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

            div.appendChild(gameSpan);
            div.appendChild(detailsSpan);
            div.appendChild(dateSpan);
            list.appendChild(div);
        });
    }

    renderStreak() {
        const streak = this.getDayStreak();
        document.getElementById('streak-num').textContent = streak;
        const badge = document.getElementById('streak-badge');
        badge.style.display = streak > 0 ? 'inline-flex' : 'none';
    }

    renderAll() {
        this.renderHistory();
        this.renderCardBests();
        this.renderAnalytics();
        this.renderStreak();
    }

    exportData(username = '') {
        const history = this.getHistory();
        const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const namePart = username ? `-${username.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
        a.download = `doddgames${namePart}-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (!Array.isArray(parsed)) throw new Error('Invalid format');
                const valid = parsed.filter(entry =>
                    entry && entry.game && entry.date && typeof entry.game === 'string'
                );
                // Batch import in a single request
                const entries = valid.map(entry => ({
                    game: entry.game,
                    data: entry.data || {},
                    displayText: entry.displayText || '',
                }));
                const res = await fetch('/api/scores/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entries }),
                });
                const result = res.ok ? await res.json() : { imported: 0 };
                await this.loadFromServer();
                this.renderAll();
                alert(`Imported ${result.imported} of ${valid.length} entries.`);
            } catch (err) {
                alert('Invalid file format. Please select a valid DoddGames export JSON.');
            }
            event.target.value = '';
        };
        reader.readAsText(file);
    }
}
