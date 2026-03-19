/* ══════════════════════════════════════════════════════════
   SCORE MANAGER — structured localStorage persistence
   ══════════════════════════════════════════════════════════

   All session data is stored in localStorage under the key
   'doddgames_history' as a JSON array of entry objects.
   Each entry has the shape: { game, data, displayText, date }
     - game:        string identifier for the game (e.g. 'schulte', 'stroop')
     - data:        raw metric object saved by the game (shape varies per game)
     - displayText: human-readable summary string shown in the history list
     - date:        ISO 8601 timestamp of when the session was saved

   The array is capped at 200 entries (oldest are dropped). Entries
   are always stored newest-first so index 0 is the most recent session.
*/
export class ScoreManager {
    constructor(historyKey = 'doddgames_history') {
        // localStorage key used for all read/write operations.
        // When multi-user is active this will be 'doddgames_history_<userId>'.
        this.HISTORY_KEY = historyKey;
    }

    // Returns the full history array from localStorage, or [] on parse failure.
    getHistory() {
        try { return JSON.parse(localStorage.getItem(this.HISTORY_KEY)) || []; }
        catch { return []; }
    }

    // Prepends a new entry to the history and enforces the 200-entry cap.
    saveScore(game, data, displayText) {
        const history = this.getHistory();
        history.unshift({ game, data, displayText, date: new Date().toISOString() });
        if (history.length > 200) history.length = 200;
        localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
    }

    // Wipes all stored sessions and re-renders the UI to reflect the empty state.
    clearHistory() {
        localStorage.removeItem(this.HISTORY_KEY);
        this.renderAll();
    }

    // Returns every history entry whose game field matches the given key.
    getGameHistory(game) {
        return this.getHistory().filter(e => e.game === game);
    }

    // Returns the single best-ever metric value for a game across all stored sessions.
    // "Best" is game-type-specific:
    //   - Time-based games (schulte, trails-a, trails-b): lowest time, capped at <999s
    //   - Score-based games (tetris, symbol-digit): highest score
    //   - Accuracy-based games (stroop, gonogo, cpt): highest accuracy percentage
    //   - Categorical outcomes (card-sort, tower, word-list): highest count
    // Returns null when no valid sessions exist for the game.
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
        }
        return null;
    }

    // Canonical metric extractor: pulls the single most meaningful numeric value
    // from a history entry's data object for a given game.
    //
    // This is the authoritative source of truth for which data field represents
    // "performance" for each game. It is consumed by:
    //   - getSparklineData()  → sparkline rendering on game cards and analytics cards
    //   - getRollingAverage() → analytics card averages (last 5 / last 20 sessions)
    //   - ProfileManager      → within-user z-score computation
    //
    // Time-based games exclude sentinel values >= 999s (indicates an aborted run).
    // Returns null when the entry lacks data or the game key is unrecognised.
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
            default:
                return null;
        }
    }

    // Averages the extracted metric over the n most-recent sessions for a game.
    // Sessions with null metrics (e.g. aborted runs) are excluded from both the
    // numerator and denominator.
    getRollingAverage(game, n) {
        const entries = this.getGameHistory(game).slice(0, n);
        if (entries.length === 0) return null;
        const values = entries.map(e => this._extractMetric(game, e)).filter(v => v != null);
        if (values.length === 0) return null;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    // Returns up to n metric values in chronological order (oldest first) for use
    // as sparkline input. History is stored newest-first, so the slice is reversed.
    // Null/missing metrics are replaced with 0 to keep the sparkline continuous.
    getSparklineData(game, n = 20) {
        const entries = this.getGameHistory(game).slice(0, n).reverse();
        return entries.map(e => this._extractMetric(game, e) || 0);
    }

    // Counts the number of consecutive calendar days (ending today or yesterday)
    // on which the user completed at least one session.
    //
    // Algorithm:
    //   1. Collect the unique calendar dates present in the full history.
    //   2. Sort those dates descending (most recent first).
    //   3. Walk backwards from today; a day is part of the streak if it matches the
    //      expected date exactly. A one-day grace is applied at position 0 so that a
    //      streak earned yesterday is not broken before the user plays today.
    //   4. The first gap terminates the streak.
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
                // Grace case: most-recent session was yesterday, not today.
                // Slide the reference window back so yesterday becomes the new
                // baseline and the streak is not prematurely broken.
                streak++;
                today.setTime(d.getTime());
            } else {
                break;
            }
        }
        return streak;
    }

    // Draws a compact sparkline on the given canvas element.
    // Used on individual game cards. Each data point is a metric value;
    // the y-axis range is auto-scaled to the data. The most-recent point
    // is highlighted with a cyan dot.
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

    // Draws a larger sparkline with area fill for the analytics section.
    // Renders a filled polygon beneath the line and a dot at each data point.
    // Falls back to a "Not enough data" label when fewer than 2 points exist.
    // color is a CSS hex string; the fill uses that color at ~8% opacity (appended '15').
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

    // Populates the best-score label and sparkline for every game card on the
    // scores page. Cards are identified by the DOM id pattern 'card-best-{key}'.
    // If no sessions exist for a game, the value cell shows '--'.
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

    // Builds and injects analytics cards into '#analytics-row'.
    // Each card shows: rolling average over last 5 sessions, rolling average over
    // last 20 sessions, total session count, and an area-fill sparkline.
    // Games with zero recorded sessions are skipped entirely.
    // Sparklines are deferred to the next animation frame so layout is settled
    // before canvas dimensions are read.
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

    // Renders the full session history list into '#history-list'.
    // Entries are already newest-first from localStorage.
    // Each row shows: game name, displayText summary, and a formatted timestamp.
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
            'symbol-digit': 'Symbol Digit', 'word-list': 'Word List', cpt: 'CPT'
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

    // Updates the streak badge element ('#streak-badge') with the current day
    // streak count. The badge is hidden entirely when the streak is 0.
    renderStreak() {
        const streak = this.getDayStreak();
        document.getElementById('streak-num').textContent = streak;
        const badge = document.getElementById('streak-badge');
        badge.style.display = streak > 0 ? 'inline-flex' : 'none';
    }

    // Top-level render orchestrator. Call this whenever the scores page is shown
    // or data changes. Executes all four render passes in order:
    //   1. renderHistory()   — session log list
    //   2. renderCardBests() — per-game best-score cards with sparklines
    //   3. renderAnalytics() — rolling-average analytics cards with area sparklines
    //   4. renderStreak()    — consecutive-day streak badge
    renderAll() {
        this.renderHistory();
        this.renderCardBests();
        this.renderAnalytics();
        this.renderStreak();
    }

    // Serialises the full history array to a pretty-printed JSON file and
    // triggers a browser download named 'doddgames-export-YYYY-MM-DD.json'.
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

    // Reads a previously exported JSON file and merges it into the current history.
    // Deduplication strategy: entries from the import file whose ISO date string
    // already exists in localStorage are silently dropped. Only genuinely new
    // entries are added. The merged result is re-sorted newest-first and re-capped
    // at 200 entries before being written back. renderAll() is called on success.
    importData(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if (!Array.isArray(imported)) throw new Error('Invalid format');
                // Validate: each entry must have at least a game string and a date.
                const valid = imported.filter(entry =>
                    entry && entry.game && entry.date && typeof entry.game === 'string'
                );
                const existing = this.getHistory();
                // Use the ISO date string as a unique key for deduplication.
                const existingDates = new Set(existing.map(e => e.date));
                const newEntries = valid.filter(e => !existingDates.has(e.date));
                const merged = [...existing, ...newEntries]
                    .sort((a, b) => new Date(b.date) - new Date(a.date));
                if (merged.length > 200) merged.length = 200;
                localStorage.setItem(this.HISTORY_KEY, JSON.stringify(merged));
                this.renderAll();
                alert(`Imported ${newEntries.length} new entries.`);
            } catch (err) {
                alert('Invalid file format. Please select a valid DoddGames export JSON.');
            }
            event.target.value = '';
        };
        reader.readAsText(file);
    }
}
