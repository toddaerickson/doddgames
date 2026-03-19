/* ══════════════════════════════════════════════════════════
   WORD LIST LEARNING — Memory: encoding, consolidation, retrieval
   Learn 15 words across 3 study-test cycles, then recognition.

   PARADIGM OVERVIEW
   ─────────────────
   Three word lists (15 words each) are available, each paired with a
   matched foil list for the recognition phase. One list+foil pair is
   chosen randomly per session so repeat testers encounter different
   stimuli.

   PHASE STATE MACHINE
   ───────────────────
   idle → study (trial 1) → recall (trial 1)
        → study (trial 2) → recall (trial 2)
        → study (trial 3) → recall (trial 3)
        → recognition → done

   STUDY PHASE
   ───────────
   All 15 words are shown one at a time for 2 s each (STUDY_TIME),
   in a newly shuffled order on every trial.

   RECALL PHASE (3 trials × 60 s)
   ───────────────────────────────
   After each study pass, the participant has 60 s (RECALL_TIME) to
   type as many words as they remember. Duplicate entries are rejected.
   Only words from the current list are accepted as correct.
   The raw counts per trial (e.g. 7 → 10 → 13) are stored in
   trialRecalls[] and form the LEARNING CURVE — a key diagnostic metric.
   A rising curve reflects normal consolidation; a flat or declining
   curve signals encoding failure.

   RECOGNITION PHASE (30 items — 1 block only, no repetition)
   ────────────────────────────────────────────────────────────
   After all 3 recall trials, 15 studied words (old) are mixed with
   15 unseen foil words (new) and presented one at a time. The
   participant clicks "Old" or "New" for each item.
   Hits  = "Old" response to a studied word.
   False alarms = "Old" response to a foil word.

   CLINICAL DISSOCIATION
   ─────────────────────
   Poor free recall + GOOD recognition  → retrieval deficit
     (information is encoded but hard to access without a cue;
      pattern associated with ADHD / frontal-lobe dysfunction)

   Poor free recall + POOR recognition  → encoding deficit
     (information was not stored durably;
      pattern associated with age-related memory decline / hippocampal damage)

   ══════════════════════════════════════════════════════════ */
export class WordListGame {
    constructor(app) {
        this.app = app;

        // Three distinct word lists (15 words each). One is selected randomly
        // per session so that re-testers do not see the same words twice in a row.
        this.WORD_LISTS = [
            ['drum', 'curtain', 'bell', 'coffee', 'school', 'parent', 'moon', 'garden', 'hat', 'farmer', 'nose', 'turkey', 'color', 'house', 'river'],
            ['desk', 'ranger', 'bird', 'shoe', 'stove', 'mountain', 'glasses', 'towel', 'cloud', 'boat', 'lamb', 'gun', 'pencil', 'church', 'fish'],
            ['flag', 'honey', 'train', 'bottle', 'ladder', 'window', 'candle', 'forest', 'ring', 'marble', 'ocean', 'spider', 'piano', 'doctor', 'blanket'],
        ];

        // Foil words for recognition — matched to the corresponding word list for
        // frequency and semantic category to prevent easy rejection on surface features.
        // FOIL_LISTS[i] always pairs with WORD_LISTS[i].
        this.FOIL_LISTS = [
            ['chair', 'flower', 'stone', 'butter', 'circle', 'finger', 'village', 'captain', 'engine', 'carpet', 'mirror', 'rabbit', 'corner', 'silver', 'bridge'],
            ['table', 'winter', 'grape', 'pocket', 'basket', 'letter', 'branch', 'candle', 'planet', 'castle', 'hammer', 'insect', 'pillow', 'shadow', 'ticket'],
            ['brush', 'garden', 'shell', 'butter', 'magnet', 'valley', 'temple', 'dinner', 'tunnel', 'feather', 'pepper', 'rabbit', 'collar', 'meadow', 'jacket'],
        ];

        this.STUDY_TIME = 2000;     // ms each word is displayed during the study phase
        this.RECALL_TIME = 60;      // seconds available for free recall per trial
        this.NUM_TRIALS = 3;        // number of study-recall cycles before recognition

        this.currentList = [];
        this.currentFoils = [];
        this.listIdx = 0;           // which word list (0–2) was selected this session
        this.trial = 0;             // current study-recall trial number (1-indexed)
        this.trialRecalls = [];     // recall counts per trial: [trial1count, trial2count, trial3count]
                                    // these three numbers define the learning curve
        this.phase = 'idle';        // phase state machine: idle | study | recall | recognition | done
        this.studyIdx = 0;          // index into the shuffled study word array
        this.studyTimer = null;
        this.recallTimer = null;
        this.recallTimeLeft = 0;
        this.recalledWords = new Set();   // tracks correctly recalled words within the current trial
        this.recognitionItems = [];       // shuffled array of {word, isOld} objects (30 total)
        this.recognitionIdx = 0;
        this.recognitionHits = 0;         // "Old" responses to actually-old words
        this.recognitionFalseAlarms = 0;  // "Old" responses to foil words
        this.recognitionTotal = 0;

        this._handleRecallKey = this._handleRecallKey.bind(this);
        this._handleRecognitionClick = this._handleRecognitionClick.bind(this);
    }

    init() {
        this.trial = 0;
        this.trialRecalls = [];
        this.recalledWords = new Set();
        this.recognitionHits = 0;
        this.recognitionFalseAlarms = 0;
        this.recognitionTotal = 0;
        this.phase = 'idle';

        // Pick a word list (and its paired foil list) randomly each session
        this.listIdx = Math.floor(Math.random() * this.WORD_LISTS.length);
        this.currentList = [...this.WORD_LISTS[this.listIdx]];
        this.currentFoils = [...this.FOIL_LISTS[this.listIdx]];

        document.getElementById('wordlist-trial').textContent = '1';
        document.getElementById('wordlist-recalled').textContent = '0';
        document.getElementById('wordlist-phase').textContent = 'Study';
        document.getElementById('wordlist-learning-curve').textContent = '--';

        this._clearDisplay();
        this._startTrial();
    }

    cleanup() {
        clearTimeout(this.studyTimer);
        clearInterval(this.recallTimer);
        document.removeEventListener('keydown', this._handleRecallKey);
        const container = document.getElementById('wordlist-recognition');
        if (container) container.removeEventListener('click', this._handleRecognitionClick);
    }

    // Hide all interactive areas between phases.
    // NOTE: recognition buttons are only hidden (display:none), NOT removed from the DOM.
    // This is intentional — a previous bug destroyed the buttons and broke later phases;
    // keeping them in the DOM and toggling visibility avoids that regression.
    _clearDisplay() {
        document.getElementById('wordlist-display').textContent = '';
        document.getElementById('wordlist-input-area').style.display = 'none';
        document.getElementById('wordlist-recognition').style.display = 'none';
        document.getElementById('wordlist-feedback').textContent = '';
    }

    // Begin a new study-recall cycle. Words are re-shuffled on every trial so
    // serial-position effects don't favour the same words across repetitions.
    _startTrial() {
        this.trial++;
        this.recalledWords = new Set();
        document.getElementById('wordlist-trial').textContent = this.trial;
        document.getElementById('wordlist-phase').textContent = 'Study';
        document.getElementById('wordlist-recalled').textContent = '0';
        this._clearDisplay();

        // Shuffle word order for each study trial
        const shuffled = [...this.currentList];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        this._studyWords = shuffled;
        this.studyIdx = 0;
        this._showNextStudyWord();
    }

    // Advance through study words one at a time (2 s each).
    // When all words have been shown, transitions to the recall phase.
    _showNextStudyWord() {
        if (this.app.gamePaused) { setTimeout(() => this._showNextStudyWord(), 100); return; }
        if (this.studyIdx >= this._studyWords.length) {
            // Study phase complete — start recall
            this._startRecall();
            return;
        }

        const display = document.getElementById('wordlist-display');
        display.textContent = this._studyWords[this.studyIdx];
        display.style.animation = 'none';
        void display.offsetWidth;
        display.style.animation = 'countPop 0.4s ease-out';

        this.studyIdx++;
        this.studyTimer = setTimeout(() => this._showNextStudyWord(), this.STUDY_TIME);
    }

    // Start the 60-second free-recall window. The participant types words
    // into the text input and submits with Enter or the button.
    // A countdown timer is shown; it turns red in the final 10 seconds.
    _startRecall() {
        this.phase = 'recall';
        this.recallTimeLeft = this.RECALL_TIME;
        document.getElementById('wordlist-phase').textContent = 'Recall';
        document.getElementById('wordlist-display').textContent = 'Type remembered words';

        const inputArea = document.getElementById('wordlist-input-area');
        inputArea.style.display = 'flex';
        const input = document.getElementById('wordlist-input');
        input.value = '';
        input.focus();

        const timerEl = document.getElementById('wordlist-recall-timer');
        timerEl.textContent = this.recallTimeLeft + 's';
        timerEl.style.display = 'inline';

        document.addEventListener('keydown', this._handleRecallKey);

        const submitBtn = document.getElementById('wordlist-submit');
        submitBtn.onclick = () => this._submitWord();

        this.recallTimer = setInterval(() => {
            if (this.app.gamePaused) return;
            this.recallTimeLeft--;
            timerEl.textContent = this.recallTimeLeft + 's';
            if (this.recallTimeLeft <= 10) timerEl.style.color = '#e74c3c';
            if (this.recallTimeLeft <= 0) {
                this._endRecall();
            }
        }, 1000);
    }

    // Intercept Enter key during recall to submit words without losing input focus.
    _handleRecallKey(e) {
        if (this.phase !== 'recall') return;
        if (e.key === 'Enter') {
            e.preventDefault();
            this._submitWord();
        }
    }

    // Validate a typed word against the current list.
    // Accepted words are added to recalledWords (a Set, so duplicates are automatically rejected).
    // Intrusion errors (words not in the list) are flagged but not counted.
    _submitWord() {
        const input = document.getElementById('wordlist-input');
        const word = input.value.trim().toLowerCase();
        input.value = '';

        if (!word) return;

        const feedback = document.getElementById('wordlist-feedback');

        if (this.recalledWords.has(word)) {
            feedback.textContent = 'Already recalled!';
            feedback.style.color = '#f39c12';
            return;
        }

        if (this.currentList.includes(word)) {
            this.recalledWords.add(word);
            document.getElementById('wordlist-recalled').textContent = this.recalledWords.size;
            feedback.textContent = 'Correct!';
            feedback.style.color = '#2ecc71';
            this.app.audio.playCorrect();
            this.app.audio.haptic(15);
        } else {
            feedback.textContent = 'Not in the list';
            feedback.style.color = '#e74c3c';
            this.app.audio.playWrong();
        }

        setTimeout(() => { feedback.textContent = ''; }, 1000);
        input.focus();
    }

    // Called when the recall timer expires. Records this trial's count, updates the
    // learning curve display (e.g. "7 → 10 → 13"), then either starts the next
    // study-recall cycle or advances to recognition if all 3 trials are complete.
    _endRecall() {
        clearInterval(this.recallTimer);
        this.recallTimer = null;
        document.removeEventListener('keydown', this._handleRecallKey);
        this.phase = 'idle';

        // Append this trial's recall count — trialRecalls grows to [t1, t2, t3]
        this.trialRecalls.push(this.recalledWords.size);
        const curveText = this.trialRecalls.join(' → ');
        document.getElementById('wordlist-learning-curve').textContent = curveText;
        document.getElementById('wordlist-recall-timer').style.display = 'none';
        document.getElementById('wordlist-recall-timer').style.color = '#00d4ff';
        document.getElementById('wordlist-input-area').style.display = 'none';

        if (this.trial < this.NUM_TRIALS) {
            // More study-recall cycles
            document.getElementById('wordlist-display').textContent = `Trial ${this.trial}: ${this.recalledWords.size}/15 recalled`;
            setTimeout(() => this._startTrial(), 2000);
        } else {
            // All trials done — start recognition
            document.getElementById('wordlist-display').textContent = `Learning complete! Starting recognition...`;
            setTimeout(() => this._startRecognition(), 2500);
        }
    }

    // Build the 30-item recognition array (15 old + 15 new), shuffle it, and
    // present items one at a time. The participant clicks "Old" or "New" for each.
    _startRecognition() {
        this.phase = 'recognition';
        document.getElementById('wordlist-phase').textContent = 'Recognition';
        this._clearDisplay();

        // Build recognition items: 15 old + 15 new, shuffled
        this.recognitionItems = [];
        for (const w of this.currentList) {
            this.recognitionItems.push({ word: w, isOld: true });
        }
        for (const w of this.currentFoils) {
            this.recognitionItems.push({ word: w, isOld: false });
        }
        // Shuffle
        for (let i = this.recognitionItems.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.recognitionItems[i], this.recognitionItems[j]] = [this.recognitionItems[j], this.recognitionItems[i]];
        }

        this.recognitionIdx = 0;
        this.recognitionHits = 0;
        this.recognitionFalseAlarms = 0;
        this.recognitionTotal = 0;

        const container = document.getElementById('wordlist-recognition');
        container.style.display = 'flex';
        container.addEventListener('click', this._handleRecognitionClick);

        this._showNextRecognitionWord();
    }

    // Display the current recognition item and update the progress counter.
    // When all 30 items have been judged, ends the recognition phase.
    _showNextRecognitionWord() {
        if (this.recognitionIdx >= this.recognitionItems.length) {
            this._endRecognition();
            return;
        }

        const item = this.recognitionItems[this.recognitionIdx];
        const display = document.getElementById('wordlist-display');
        display.textContent = item.word;
        display.style.animation = 'none';
        void display.offsetWidth;
        display.style.animation = 'countPop 0.3s ease-out';

        document.getElementById('wordlist-recog-progress').textContent =
            `${this.recognitionIdx + 1} / ${this.recognitionItems.length}`;
    }

    // Handle Old/New button clicks. Uses event delegation on the container so the
    // buttons do not need to be re-attached each trial (buttons are kept in DOM).
    // Scores hits (old→old) and false alarms (old→new) for the recognition summary.
    _handleRecognitionClick(e) {
        const btn = e.target.closest('.wordlist-recog-btn');
        if (!btn) return;

        const response = btn.dataset.response; // 'old' or 'new'
        const item = this.recognitionItems[this.recognitionIdx];
        this.recognitionTotal++;

        const feedback = document.getElementById('wordlist-feedback');

        if (response === 'old' && item.isOld) {
            this.recognitionHits++;
            feedback.textContent = 'Correct — it was in the list!';
            feedback.style.color = '#2ecc71';
            this.app.audio.playCorrect();
        } else if (response === 'new' && !item.isOld) {
            feedback.textContent = 'Correct — it was new!';
            feedback.style.color = '#2ecc71';
            this.app.audio.playCorrect();
        } else if (response === 'old' && !item.isOld) {
            // False alarm: called an unseen foil "old"
            this.recognitionFalseAlarms++;
            feedback.textContent = 'Incorrect — it was new';
            feedback.style.color = '#e74c3c';
            this.app.audio.playWrong();
        } else {
            // Miss: failed to recognise a studied word
            feedback.textContent = 'Incorrect — it was in the list';
            feedback.style.color = '#e74c3c';
            this.app.audio.playWrong();
        }

        this.recognitionIdx++;
        setTimeout(() => {
            feedback.textContent = '';
            this._showNextRecognitionWord();
        }, 800);
    }

    // Wrap up recognition: hide buttons, compute hit rate and false-alarm rate,
    // and display a brief summary. Full results are available via getResults().
    _endRecognition() {
        this.phase = 'done';
        document.getElementById('wordlist-recognition').style.display = 'none';
        document.getElementById('wordlist-recognition').removeEventListener('click', this._handleRecognitionClick);
        document.getElementById('wordlist-phase').textContent = 'Complete';

        const hitRate = Math.round((this.recognitionHits / 15) * 100);
        const faRate = Math.round((this.recognitionFalseAlarms / 15) * 100);

        document.getElementById('wordlist-display').textContent =
            `Recognition: ${hitRate}% hits, ${faRate}% false alarms`;
    }

    // Return standardised results for the session dashboard.
    //
    // Key metrics:
    //   trial1/2/3    — raw recall counts per trial (learning curve)
    //   totalRecalled — sum across all three trials
    //   hitRate       — % of old words correctly identified in recognition
    //   faRate        — % of new (foil) words incorrectly called "old"
    //
    // Clinical interpretation (provided in summary for reviewers):
    //   Poor recall + good recognition  → retrieval deficit (ADHD / frontal lobe)
    //   Poor recall + poor recognition  → encoding deficit (age-related decline)
    //   Flat learning curve             → encoding failure across repetitions
    getResults() {
        const trial1 = this.trialRecalls[0] || 0;
        const trial2 = this.trialRecalls[1] || 0;
        const trial3 = this.trialRecalls[2] || 0;
        const hitRate = Math.round((this.recognitionHits / 15) * 100);
        const faRate = Math.round((this.recognitionFalseAlarms / 15) * 100);

        const data = {
            trial1, trial2, trial3,
            totalRecalled: trial1 + trial2 + trial3,
            recognitionHits: this.recognitionHits,
            recognitionFalseAlarms: this.recognitionFalseAlarms,
            hitRate, faRate,
        };

        const displayText = `Recall: ${trial1}→${trial2}→${trial3} | Recog: ${hitRate}% hits`;
        const summary = `Trial 1: ${trial1}/15<br>Trial 2: ${trial2}/15<br>Trial 3: ${trial3}/15<br>Learning curve: ${trial1} → ${trial2} → ${trial3}<br><br>Recognition hits: ${hitRate}%<br>False alarms: ${faRate}%<br><br><em>Poor recall + good recognition = retrieval deficit (ADHD/frontal)<br>Poor recall + poor recognition = encoding deficit (age-related)<br>Flat learning curve = encoding failure</em>`;
        return { data, displayText, summary };
    }
}
