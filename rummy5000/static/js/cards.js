/* Card DOM rendering — pure CSS cards, no images. */

const SUIT_SYMBOLS = {
    hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660'
};

export function createCardEl(card, options = {}) {
    const el = document.createElement('div');
    el.className = 'card';
    if (options.small) el.classList.add('card-sm');
    el.dataset.cardId = card.id;

    if (card.is_joker) {
        const face = document.createElement('div');
        face.className = 'card-face joker';
        face.innerHTML = `
            <div class="card-corner"><span class="card-rank">J</span><span class="card-suit-small">\u2605</span></div>
            <div class="card-center-suit">\u2605</div>
            <div class="card-corner-br"><span class="card-rank">J</span><span class="card-suit-small">\u2605</span></div>
        `;
        el.appendChild(face);
    } else {
        const sym = SUIT_SYMBOLS[card.suit] || '?';
        const face = document.createElement('div');
        face.className = `card-face ${card.suit}`;
        face.innerHTML = `
            <div class="card-corner"><span class="card-rank">${card.rank}</span><span class="card-suit-small">${sym}</span></div>
            <div class="card-center-suit">${sym}</div>
            <div class="card-corner-br"><span class="card-rank">${card.rank}</span><span class="card-suit-small">${sym}</span></div>
        `;
        el.appendChild(face);
    }

    return el;
}

export function createCardBack(options = {}) {
    const el = document.createElement('div');
    el.className = 'card';
    if (options.small) el.classList.add('card-sm');
    const back = document.createElement('div');
    back.className = 'card-back';
    el.appendChild(back);
    return el;
}

export function createMeldGroup(meld, options = {}) {
    const group = document.createElement('div');
    group.className = 'meld-group';
    if (options.meldIndex !== undefined) group.dataset.meldIndex = options.meldIndex;
    if (options.highlight) group.classList.add('highlight');

    meld.forEach(card => {
        const cardEl = createCardEl(card);
        group.appendChild(cardEl);
    });

    return group;
}
