/* ══════════════════════════════════════════════════════════
   CARD SORT (WCST) — Executive function: set-shifting
   Simplified Wisconsin Card Sorting Test (WCST).

   Task overview:
   - 4 reference cards are displayed; the user sorts a stimulus card
     by clicking the reference card they believe it matches.
   - Sorting can be done by color, shape, or count — but the active
     rule is never told to the user; they must infer it from feedback.
   - After 10 consecutive correct responses, the rule silently shifts.
     The user must detect the change and adapt.

   Key clinical metric — perseverative errors:
   - A perseverative error occurs when the user responds incorrectly
     AND their chosen card matches the PREVIOUS (now-obsolete) rule.
   - This indicates they are still applying the old rule after a shift,
     a hallmark of frontal lobe / executive dysfunction.

   Rule sequencing:
   - The three rules (color, shape, count) are shuffled into a random
     initial order, then that order repeats for 4 full cycles, giving
     up to 12 rule categories per session.

   Cards:
   - Shapes: circle, triangle, square, star (rendered as inline SVG)
   - Colors: red, blue, green, yellow
   - Counts: 1–4 symbols per card
   - Each reference card has a unique value on all three dimensions,
     so exactly one reference card matches on any given rule.
   ══════════════════════════════════════════════════════════ */
export class CardSortGame {
    constructor(app) {
        this.app = app;

        // The four possible values for each sorting dimension
        this.COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
        this.COLOR_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];
        this.SHAPES = ['circle', 'triangle', 'square', 'star'];
        this.COUNTS = [1, 2, 3, 4];

        // Number of consecutive correct responses required to trigger a rule shift
        this.CONSECUTIVE_TO_SHIFT = 10;

        // Reference cards — one of each unique combination anchor
        // Each card has a unique color, shape, AND count, so only one card
        // can ever be the correct match for any given rule dimension.
        this.referenceCards = [
            { color: 0, shape: 0, count: 0 }, // 1 red circle
            { color: 1, shape: 1, count: 1 }, // 2 blue triangles
            { color: 2, shape: 2, count: 2 }, // 3 green squares
            { color: 3, shape: 3, count: 3 }, // 4 yellow stars
        ];

        this.currentRule = 'color';  // color | shape | count — hidden from user
        this.ruleOrder = [];         // pre-generated sequence of rule shifts
        this.ruleIdx = 0;            // current position in ruleOrder
        this.consecutiveCorrect = 0; // resets to 0 on any error
        this.categoriesCompleted = 0;// number of successful rule completions
        this.totalErrors = 0;
        this.perseverativeErrors = 0;// errors matching the OLD rule (key metric)
        this.previousRule = null;    // rule that was active before the last shift

        this.stimulusCard = null;    // the card currently being sorted
        this.locked = false;         // prevents double-input during feedback delay

        this._clickHandler = this._clickHandler.bind(this);
    }

    init() {
        this.consecutiveCorrect = 0;
        this.categoriesCompleted = 0;
        this.totalErrors = 0;
        this.perseverativeErrors = 0;
        this.previousRule = null;
        this.locked = false;

        // Randomize rule order, cycling through all 3 rules
        this._generateRuleOrder();
        this.ruleIdx = 0;
        this.currentRule = this.ruleOrder[0];

        document.getElementById('cardsort-categories').textContent = '0';
        document.getElementById('cardsort-errors').textContent = '0';
        document.getElementById('cardsort-persev').textContent = '0';
        document.getElementById('cardsort-feedback').textContent = '';

        this._drawReferenceCards();
        this._nextStimulus();

        // Single delegated listener on the reference container;
        // individual card clicks bubble up and are caught here.
        const refContainer = document.getElementById('cardsort-references');
        refContainer.addEventListener('click', this._clickHandler);
    }

    cleanup() {
        const refContainer = document.getElementById('cardsort-references');
        refContainer.removeEventListener('click', this._clickHandler);
    }

    _generateRuleOrder() {
        // Shuffle the three rules into a random starting order, then
        // repeat that shuffled order for 4 cycles so the session can
        // run long enough to accumulate meaningful perseverative data.
        // Example output: ['shape','color','count', 'shape','color','count', ...]
        const rules = ['color', 'shape', 'count'];
        // Fisher-Yates shuffle for initial order
        for (let i = rules.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rules[i], rules[j]] = [rules[j], rules[i]];
        }
        this.ruleOrder = [];
        for (let cycle = 0; cycle < 4; cycle++) {
            this.ruleOrder.push(...rules);
        }
    }

    _nextStimulus() {
        if (this.app.gamePaused) { setTimeout(() => this._nextStimulus(), 100); return; }
        // Generate a stimulus card that has a unique match for each dimension
        // against the reference cards (so there's exactly one match per rule)
        const color = Math.floor(Math.random() * 4);
        const shape = Math.floor(Math.random() * 4);
        const count = Math.floor(Math.random() * 4);

        this.stimulusCard = { color, shape, count };
        this.locked = false;
        this._drawStimulusCard();
    }

    _drawReferenceCards() {
        const container = document.getElementById('cardsort-references');
        container.innerHTML = '';

        // Render each of the 4 fixed reference cards with a data-idx attribute
        // so the click handler can identify which reference was chosen.
        this.referenceCards.forEach((card, idx) => {
            const el = document.createElement('div');
            el.className = 'cardsort-card cardsort-ref';
            el.dataset.idx = idx;
            el.innerHTML = this._renderCardShapes(card);
            container.appendChild(el);
        });
    }

    _drawStimulusCard() {
        const container = document.getElementById('cardsort-stimulus');
        container.innerHTML = '';
        const el = document.createElement('div');
        el.className = 'cardsort-card cardsort-stim';
        el.innerHTML = this._renderCardShapes(this.stimulusCard);
        container.appendChild(el);
    }

    _renderCardShapes(card) {
        // Build the SVG shape grid for a card.
        // Each card displays `count` copies of its shape in its color.
        const color = this.COLORS[card.color];
        const shapeName = this.SHAPES[card.shape];
        const count = this.COUNTS[card.count];
        let shapeSVGs = '';

        for (let i = 0; i < count; i++) {
            shapeSVGs += this._shapeSVG(shapeName, color);
        }

        return `<div class="cardsort-shapes">${shapeSVGs}</div>`;
    }

    _shapeSVG(shape, color) {
        // Renders a single shape as an inline SVG (28×28 px viewbox).
        // All four shapes fit within the same bounding box for visual consistency.
        const size = 28;
        switch (shape) {
            case 'circle':
                return `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="${color}"/></svg>`;
            case 'triangle':
                return `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><polygon points="14,2 26,26 2,26" fill="${color}"/></svg>`;
            case 'square':
                return `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><rect x="2" y="2" width="24" height="24" rx="2" fill="${color}"/></svg>`;
            case 'star':
                return `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><polygon points="14,2 17.5,10.5 26,11 19.5,17 21.5,26 14,21 6.5,26 8.5,17 2,11 10.5,10.5" fill="${color}"/></svg>`;
            default:
                return '';
        }
    }

    _clickHandler(e) {
        if (this.locked) return;
        const refEl = e.target.closest('.cardsort-ref');
        if (!refEl) return;

        // Lock immediately to prevent duplicate responses during the feedback pause
        this.locked = true;
        const refIdx = parseInt(refEl.dataset.idx);
        const refCard = this.referenceCards[refIdx];

        // Check if the stimulus matches the chosen reference on the CURRENT (hidden) rule
        const correct = this.stimulusCard[this.currentRule] === refCard[this.currentRule];

        const feedbackEl = document.getElementById('cardsort-feedback');

        if (correct) {
            this.consecutiveCorrect++;
            refEl.classList.add('cardsort-correct');
            feedbackEl.textContent = 'Correct!';
            feedbackEl.style.color = '#2ecc71';
            this.app.audio.playCorrect();
            this.app.audio.haptic(25);

            // Check for category completion (rule shift trigger)
            // Once the streak reaches the threshold, silently advance to the next rule.
            if (this.consecutiveCorrect >= this.CONSECUTIVE_TO_SHIFT) {
                this.categoriesCompleted++;
                document.getElementById('cardsort-categories').textContent = this.categoriesCompleted;
                this.previousRule = this.currentRule; // remember for perseverative error detection
                this.ruleIdx++;

                if (this.ruleIdx < this.ruleOrder.length) {
                    this.currentRule = this.ruleOrder[this.ruleIdx];
                } else {
                    // Exhausted rules — loop back to start of pre-generated order
                    this.ruleIdx = 0;
                    this.currentRule = this.ruleOrder[0];
                }

                this.consecutiveCorrect = 0;

                // Brief "Rule Changed" flash — informs the user a shift occurred
                // but does NOT reveal what the new rule is.
                feedbackEl.textContent = 'Category complete! Rule has shifted.';
                feedbackEl.style.color = '#f39c12';
            }
        } else {
            this.totalErrors++;
            this.consecutiveCorrect = 0; // any error resets the streak
            document.getElementById('cardsort-errors').textContent = this.totalErrors;

            // Perseverative error check:
            // If the user's response would have been CORRECT under the previous rule,
            // they are still applying the old strategy — this is the key WCST metric.
            if (this.previousRule !== null) {
                const matchedOldRule = this.stimulusCard[this.previousRule] === refCard[this.previousRule];
                if (matchedOldRule) {
                    this.perseverativeErrors++;
                    document.getElementById('cardsort-persev').textContent = this.perseverativeErrors;
                }
            }

            refEl.classList.add('cardsort-wrong');
            feedbackEl.textContent = 'Incorrect';
            feedbackEl.style.color = '#e74c3c';
            this.app.audio.playWrong();
            this.app.audio.haptic([50, 30, 50]);
        }

        // Brief feedback display, then advance to the next stimulus
        setTimeout(() => {
            refEl.classList.remove('cardsort-correct', 'cardsort-wrong');
            feedbackEl.textContent = '';
            this._nextStimulus();
        }, 600);
    }

    // Returns scored results conforming to the standard game interface.
    // categoriesCompleted: number of rule completions (higher = better flexibility)
    // totalErrors: all incorrect responses
    // perseverativeErrors: subset of errors reflecting failure to abandon old rule
    getResults() {
        const data = {
            categoriesCompleted: this.categoriesCompleted,
            totalErrors: this.totalErrors,
            perseverativeErrors: this.perseverativeErrors,
        };
        const displayText = `${this.categoriesCompleted} categories | ${this.totalErrors} errors | ${this.perseverativeErrors} perseverative`;
        const summary = `Categories completed: ${this.categoriesCompleted}<br>Total errors: ${this.totalErrors}<br>Perseverative errors: ${this.perseverativeErrors}<br><br><em>High perseverative errors suggest frontal/executive dysfunction</em>`;
        return { data, displayText, summary };
    }
}
