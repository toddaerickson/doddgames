/* ══════════════════════════════════════════════════════════
   COGNITIVE PROFILE — Dashboard with radar chart, domain
   composites, pattern matching, and retest tracking.
   ══════════════════════════════════════════════════════════

   Architecture overview
   ─────────────────────
   ProfileManager wraps a ScoreManager instance and builds a
   four-domain cognitive profile from the stored session history.

   Domain composites
     Each domain is represented by a z-score composite — the average
     of per-game within-user z-scores for that domain.

   Within-user z-scores
     Z-scores are computed relative to the user's own history, NOT
     against any external normative database. A z of +1.0 means the
     most recent score is one standard deviation above the user's own
     mean. This makes the profile sensitive to personal change over
     time, regardless of absolute performance level.

   Sign convention
     Higher z-scores always mean better performance. For lower-is-better
     metrics (completion time), the raw z-score is sign-flipped so that
     a faster time still maps to a positive z.

   Pattern matching
     The user's domain z-score vector is compared to a set of reference
     vectors using cosine similarity. A match is reported only when
     similarity >= 0.3. Cosine similarity captures shape (relative
     strengths/weaknesses) rather than magnitude, so an overall low
     performer can still match an ADHD profile if the relative pattern
     is right.

   Retest detection
     Any session after the first is a retest. If all measured domains
     improve on retest, this is flagged as consistent with transient
     impairment (e.g. fatigue, stress) rather than a stable deficit —
     mirroring standard neuropsychological interpretation.
*/
export class ProfileManager {
    constructor(scores) {
        this.scores = scores;

        // DOMAINS maps each of the four cognitive domains to the games that
        // contribute to it. Every game entry defines:
        //   key            — matches the game identifier used by ScoreManager
        //   extract(data)  — pulls the relevant numeric metric from a session's
        //                    data object (mirrors _extractMetric in ScoreManager
        //                    but is defined inline here for domain-specific use)
        //   higherIsBetter — when false, the z-score sign is flipped so that a
        //                    lower raw value (faster time) still yields a positive z
        this.DOMAINS = {
            'Processing Speed': [
                { key: 'schulte', extract: d => d.bestTime < 999 ? d.bestTime : null, higherIsBetter: false },
                { key: 'trails-a', extract: d => d.bestTime < 999 ? d.bestTime : null, higherIsBetter: false },
                { key: 'symbol-digit', extract: d => d.bestRoundScore, higherIsBetter: true },
            ],
            'Executive Function': [
                { key: 'tetris', extract: d => d.score, higherIsBetter: true },
                { key: 'trails-b', extract: d => d.bestTime < 999 ? d.bestTime : null, higherIsBetter: false },
                { key: 'card-sort', extract: d => d.categoriesCompleted, higherIsBetter: true },
                { key: 'tower', extract: d => d.puzzlesSolved, higherIsBetter: true },
            ],
            'Inhibitory Control': [
                { key: 'stroop', extract: d => d.accuracy, higherIsBetter: true },
                { key: 'gonogo', extract: d => d.accuracy, higherIsBetter: true },
                { key: 'cpt', extract: d => d.accuracy, higherIsBetter: true },
            ],
            'Memory': [
                { key: 'word-list', extract: d => d.totalRecalled, higherIsBetter: true },
                { key: 'digit-span', extract: d => d.maxSpan, higherIsBetter: true },
                { key: 'nback', extract: d => d.maxLevel, higherIsBetter: true },
            ],
        };

        // REFERENCE_PROFILES define the expected z-score shape for four
        // clinically-inspired cognitive patterns. Values represent the typical
        // direction and rough magnitude of domain deviation for each pattern:
        //   positive z → above-average performance in that domain
        //   negative z → below-average performance in that domain
        //
        // These are used exclusively for cosine similarity pattern matching;
        // they do not constitute a diagnostic tool or normative comparison.
        //
        // Patterns:
        //   ADHD               — inhibitory control most impaired, variable speed
        //   TBI (Frontal)      — executive function and set-shifting most impaired
        //   Age-Related Decline — broad slowing with memory encoding decline
        //   Transient Impairment — all domains equally depressed (flat profile)
        this.REFERENCE_PROFILES = {
            'ADHD': {
                'Processing Speed': -0.3,
                'Executive Function': -0.8,
                'Inhibitory Control': -1.5,
                'Memory': -0.5,
                description: 'Attention/Executive pattern: Disproportionately weak inhibitory control with variable processing speed. Impulsive errors outweigh memory difficulties.',
            },
            'TBI (Frontal)': {
                'Processing Speed': -0.5,
                'Executive Function': -1.5,
                'Inhibitory Control': -1.0,
                'Memory': -0.7,
                description: 'Frontal injury pattern: Executive function and set-shifting are most impaired. Perseverative errors on Card Sort are a hallmark.',
            },
            'Age-Related Decline': {
                'Processing Speed': -1.3,
                'Executive Function': -0.6,
                'Inhibitory Control': -0.3,
                'Memory': -1.0,
                description: 'Age-related pattern: Broadly slowed processing speed with gradual memory encoding decline. Inhibitory control relatively preserved.',
            },
            'Transient Impairment': {
                'Processing Speed': -1.0,
                'Executive Function': -1.0,
                'Inhibitory Control': -1.0,
                'Memory': -1.0,
                description: 'Global/transient pattern: All domains equally depressed. Consistent with temporary states (fatigue, substance effects). Expect improvement on retest.',
            },
        };
    }

    /**
     * Get all valid scores for a game, excluding zeros that suggest non-participation.
     */
    _getValidScores(gameKey, extractor) {
        const entries = this.scores.getGameHistory(gameKey);
        const values = [];
        for (const entry of entries) {
            if (!entry.data) continue;
            const val = extractor(entry.data);
            if (val != null && val !== 0) values.push(val);
        }
        return values;
    }

    /**
     * Compute within-user z-score for a game's most recent score.
     *
     * The z-score measures how far the most recent session deviates from the
     * user's own historical mean, in units of their own standard deviation.
     * This is purely self-referential — no external norms are involved.
     *
     * For lower-is-better metrics (time-based games) the raw z is negated so
     * that a faster-than-average time still produces a positive (good) z-score.
     *
     * Returns null when fewer than 2 valid sessions exist, because a
     * meaningful standard deviation cannot be computed from a single data point.
     */
    _computeZScore(gameKey, extractor, higherIsBetter) {
        const values = this._getValidScores(gameKey, extractor);
        if (values.length < 2) return null;

        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
        if (sd === 0) return 0;

        const latest = values[0]; // most recent
        let z = (latest - mean) / sd;

        // Flip sign for lower-is-better metrics (time-based)
        if (!higherIsBetter) z = -z;

        return z;
    }

    /**
     * Compute domain composite z-score (average of game z-scores within domain).
     *
     * Only games with at least 2 sessions contribute a z-score. If no games in
     * a domain have enough data, that domain composite is null. A null composite
     * is excluded from pattern matching and shown as "No data" in the UI.
     */
    getDomainComposites() {
        const composites = {};

        for (const [domain, games] of Object.entries(this.DOMAINS)) {
            const zScores = [];
            for (const game of games) {
                const z = this._computeZScore(game.key, game.extract, game.higherIsBetter);
                if (z !== null) zScores.push(z);
            }

            composites[domain] = zScores.length > 0
                ? zScores.reduce((a, b) => a + b, 0) / zScores.length
                : null;
        }

        return composites;
    }

    /**
     * Get per-game z-scores for detailed view.
     *
     * Returns a flat object keyed by game identifier. Each value contains:
     *   z        — within-user z-score (null if < 2 sessions)
     *   sessions — number of valid sessions used for the calculation
     *   domain   — the cognitive domain this game belongs to
     */
    getGameZScores() {
        const results = {};
        for (const [domain, games] of Object.entries(this.DOMAINS)) {
            for (const game of games) {
                const z = this._computeZScore(game.key, game.extract, game.higherIsBetter);
                const values = this._getValidScores(game.key, game.extract);
                results[game.key] = {
                    z,
                    sessions: values.length,
                    domain,
                };
            }
        }
        return results;
    }

    /**
     * Detect retest sessions: sessions of the same game played after the first.
     * Returns retest improvement data.
     *
     * For each game with at least 2 sessions, improvement is the standardised
     * difference between the earliest and most recent score:
     *   improvement = (latest - first) / SD  [for higher-is-better games]
     *   improvement = (first - latest) / SD  [for time-based / lower-is-better games]
     *
     * A positive improvement value means the user performed better on their
     * most recent session than their first. The render() method flags global
     * improvement across 3+ games as consistent with transient impairment.
     */
    getRetestData() {
        const retestInfo = {};

        for (const [domain, games] of Object.entries(this.DOMAINS)) {
            for (const game of games) {
                const values = this._getValidScores(game.key, game.extract);
                if (values.length < 2) continue;

                const first = values[values.length - 1]; // earliest
                const latest = values[0]; // most recent
                const mean = values.reduce((a, b) => a + b, 0) / values.length;
                const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);

                let improvement = 0;
                if (sd > 0) {
                    improvement = game.higherIsBetter
                        ? (latest - first) / sd
                        : (first - latest) / sd; // for time: lower is better
                }

                retestInfo[game.key] = {
                    sessions: values.length,
                    first,
                    latest,
                    improvement: Math.round(improvement * 100) / 100,
                    domain,
                };
            }
        }

        return retestInfo;
    }

    /**
     * Match user's profile shape to reference profiles using cosine similarity.
     *
     * Cosine similarity captures the angular relationship between two vectors,
     * meaning it compares the relative pattern of domain strengths and weaknesses
     * rather than absolute z-score magnitudes. Range is -1 (opposite) to +1
     * (identical shape).
     *
     * Only domains with valid composite z-scores are included in the comparison
     * vectors; at least 2 valid domains are required to attempt matching.
     *
     * A match is reported only when the best cosine similarity >= 0.3. Below
     * this threshold the profile is considered ambiguous or insufficiently
     * differentiated to identify a pattern.
     */
    getPatternMatch() {
        const composites = this.getDomainComposites();
        const domainNames = Object.keys(this.DOMAINS);

        // Check if we have enough data
        const validDomains = domainNames.filter(d => composites[d] !== null);
        if (validDomains.length < 2) {
            return { match: null, message: 'Play more games across different domains to see pattern analysis.' };
        }

        // Build user vector (only for domains with data)
        const userVector = validDomains.map(d => composites[d]);

        let bestMatch = null;
        let bestSimilarity = -Infinity;

        for (const [name, profile] of Object.entries(this.REFERENCE_PROFILES)) {
            const refVector = validDomains.map(d => profile[d]);

            // Cosine similarity: dot(user, ref) / (|user| * |ref|)
            let dotProduct = 0, normUser = 0, normRef = 0;
            for (let i = 0; i < userVector.length; i++) {
                dotProduct += userVector[i] * refVector[i];
                normUser += userVector[i] ** 2;
                normRef += refVector[i] ** 2;
            }

            normUser = Math.sqrt(normUser);
            normRef = Math.sqrt(normRef);

            const similarity = (normUser > 0 && normRef > 0)
                ? dotProduct / (normUser * normRef)
                : 0;

            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestMatch = name;
            }
        }

        // Only report if there's meaningful similarity
        if (bestSimilarity < 0.3) {
            return {
                match: null,
                similarity: bestSimilarity,
                message: 'Your profile does not strongly match any known pattern. This may indicate normal variation or insufficient data.',
            };
        }

        const profile = this.REFERENCE_PROFILES[bestMatch];
        return {
            match: bestMatch,
            similarity: Math.round(bestSimilarity * 100) / 100,
            description: profile.description,
            message: `Your profile shape most closely resembles: <strong>${bestMatch}</strong> (similarity: ${Math.round(bestSimilarity * 100)}%)`,
        };
    }

    /**
     * Draw radar chart on canvas.
     *
     * The four domain axes are evenly spaced around the centre (90° offset so
     * the first axis points straight up). Each axis represents z-score range
     * -2 to +2, linearly mapped to radius 0 (centre) to maxR (outer ring):
     *   radius = ((z + 2) / 4) * maxR
     *
     * Domains with no data default to the midpoint radius (z = 0) so the polygon
     * remains closed; those axis labels are dimmed to signal missing data.
     * Dot colour at each axis vertex uses the same green/amber/red thresholds
     * as the domain list: green >= 0, amber >= -0.5, red < -0.5.
     */
    drawRadarChart(canvas) {
        const composites = this.getDomainComposites();
        const domainNames = Object.keys(this.DOMAINS);
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const maxR = Math.min(cx, cy) - 40;

        ctx.clearRect(0, 0, w, h);

        const n = domainNames.length;
        const angleStep = (Math.PI * 2) / n;

        // Draw grid rings
        const rings = 5;
        for (let r = 1; r <= rings; r++) {
            const radius = (r / rings) * maxR;
            ctx.beginPath();
            for (let i = 0; i <= n; i++) {
                const angle = i * angleStep - Math.PI / 2;
                const x = cx + Math.cos(angle) * radius;
                const y = cy + Math.sin(angle) * radius;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.strokeStyle = r === rings ? '#2a2a4a' : '#1a1a35';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Draw axes
        for (let i = 0; i < n; i++) {
            const angle = i * angleStep - Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
            ctx.strokeStyle = '#2a2a4a';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Draw labels
        ctx.font = 'bold 12px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let i = 0; i < n; i++) {
            const angle = i * angleStep - Math.PI / 2;
            const labelR = maxR + 25;
            const x = cx + Math.cos(angle) * labelR;
            const y = cy + Math.sin(angle) * labelR;

            const z = composites[domainNames[i]];
            ctx.fillStyle = z !== null ? '#ccc' : '#555';
            ctx.fillText(domainNames[i], x, y);

            // Show z-score below label
            if (z !== null) {
                ctx.font = '10px Segoe UI, sans-serif';
                ctx.fillStyle = z >= 0 ? '#2ecc71' : z >= -0.5 ? '#f39c12' : '#e74c3c';
                ctx.fillText(`z=${z.toFixed(2)}`, x, y + 14);
                ctx.font = 'bold 12px Segoe UI, sans-serif';
            }
        }

        // Draw data polygon
        const hasData = domainNames.some(d => composites[d] !== null);
        if (!hasData) {
            ctx.fillStyle = '#555';
            ctx.font = '14px Segoe UI, sans-serif';
            ctx.fillText('Play games to see your profile', cx, cy);
            return;
        }

        // Map z-scores to radius (z=0 = middle ring, z=-2 = center, z=2 = outer)
        const zToRadius = (z) => {
            if (z === null) return 0;
            const normalized = (z + 2) / 4; // maps -2..+2 to 0..1
            return Math.max(0, Math.min(1, normalized)) * maxR;
        };

        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const idx = i % n;
            const angle = idx * angleStep - Math.PI / 2;
            const z = composites[domainNames[idx]];
            const r = z !== null ? zToRadius(z) : maxR * 0.5; // default to middle if no data
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(123, 47, 247, 0.2)';
        ctx.fill();
        ctx.strokeStyle = '#4f8cff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw data points
        for (let i = 0; i < n; i++) {
            const angle = i * angleStep - Math.PI / 2;
            const z = composites[domainNames[i]];
            if (z === null) continue;
            const r = zToRadius(z);
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;

            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#4f8cff';
            ctx.fill();
            ctx.strokeStyle = '#0d0d20';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    /**
     * Render the full profile screen content.
     *
     * Orchestrates four UI sections in order:
     *   1. Radar chart        — visual domain z-score polygon
     *   2. Domain score list  — tabular z-score per domain with colour coding
     *   3. Pattern analysis   — cosine-similarity match result and description
     *   4. Retest tracking    — per-game improvement arrows with SD deltas;
     *                           shows a transient-impairment note when all
     *                           3+ measured games improve on retest
     * A fifth section (game detail table) lists individual game z-scores and
     * session counts for reviewers who want to inspect sub-domain contributions.
     */
    render() {
        const composites = this.getDomainComposites();
        const patternMatch = this.getPatternMatch();
        const retestData = this.getRetestData();
        const gameZScores = this.getGameZScores();

        // Radar chart
        const canvas = document.getElementById('profile-radar');
        if (canvas) {
            this.drawRadarChart(canvas);
        }

        // Domain scores list
        const domainList = document.getElementById('profile-domains');
        if (domainList) {
            domainList.innerHTML = '';
            for (const [domain, z] of Object.entries(composites)) {
                const div = document.createElement('div');
                div.className = 'profile-domain-row';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'pd-name';
                nameSpan.textContent = domain;

                const scoreSpan = document.createElement('span');
                scoreSpan.className = 'pd-score';
                if (z !== null) {
                    scoreSpan.textContent = `z = ${z.toFixed(2)}`;
                    scoreSpan.style.color = z >= 0 ? '#2ecc71' : z >= -0.5 ? '#f39c12' : '#e74c3c';
                } else {
                    scoreSpan.textContent = 'No data';
                    scoreSpan.style.color = '#555';
                }

                div.appendChild(nameSpan);
                div.appendChild(scoreSpan);
                domainList.appendChild(div);
            }
        }

        // Pattern analysis
        const patternEl = document.getElementById('profile-pattern');
        if (patternEl) {
            patternEl.innerHTML = patternMatch.message;
            if (patternMatch.description) {
                patternEl.innerHTML += `<br><br>${patternMatch.description}`;
            }
        }

        // Retest tracking
        // Improvement threshold of 0.2 SD is used to distinguish meaningful
        // change (arrow up/down) from noise (flat arrow). When all measured
        // games (>= 3) exceed this threshold the transient-impairment note fires.
        const retestEl = document.getElementById('profile-retest');
        if (retestEl) {
            const retestEntries = Object.entries(retestData).filter(([_, d]) => d.sessions >= 2);
            if (retestEntries.length === 0) {
                retestEl.innerHTML = '<span style="color:#555">Play games multiple times to see retest trends.</span>';
            } else {
                let allImproving = true;
                let html = '';
                for (const [key, d] of retestEntries) {
                    const arrow = d.improvement > 0.2 ? '&uarr;' : d.improvement < -0.2 ? '&darr;' : '&harr;';
                    const color = d.improvement > 0.2 ? '#2ecc71' : d.improvement < -0.2 ? '#e74c3c' : '#888';
                    html += `<div class="profile-retest-row"><span>${key}</span><span style="color:${color}">${arrow} ${d.improvement > 0 ? '+' : ''}${d.improvement} SD</span><span style="color:#666">${d.sessions} sessions</span></div>`;
                    if (d.improvement <= 0.2) allImproving = false;
                }

                // Global improvement across 3+ games suggests the initial baseline
                // was measured under suboptimal conditions (transient impairment)
                // rather than reflecting a stable cognitive deficit.
                if (allImproving && retestEntries.length >= 3) {
                    html += '<div class="profile-retest-note">All tested domains show improvement on retest — consistent with transient impairment rather than stable deficit.</div>';
                }

                retestEl.innerHTML = html;
            }
        }

        // Game detail table
        const detailEl = document.getElementById('profile-game-detail');
        if (detailEl) {
            const gameNames = {
                schulte: 'Schulte', tetris: 'Tetris', stroop: 'Stroop',
                'trails-a': 'Trails A', 'trails-b': 'Trails B',
                gonogo: 'Go/No-Go', 'card-sort': 'Card Sort',
                tower: 'Tower', 'symbol-digit': 'Symbol Digit',
                'word-list': 'Word List', cpt: 'CPT',
            };

            let html = '';
            for (const [key, data] of Object.entries(gameZScores)) {
                if (data.sessions === 0) continue;
                const zText = data.z !== null ? `z=${data.z.toFixed(2)}` : 'n/a';
                const zColor = data.z === null ? '#555' : data.z >= 0 ? '#2ecc71' : data.z >= -0.5 ? '#f39c12' : '#e74c3c';
                html += `<div class="profile-game-row"><span>${gameNames[key] || key}</span><span style="color:${zColor}">${zText}</span><span style="color:#666">${data.sessions} sessions</span></div>`;
            }

            detailEl.innerHTML = html || '<span style="color:#555">No game data yet.</span>';
        }
    }
}
