"""Meld validation for Rummy 5000.

Supports sets (3-4 of same rank), runs (3+ consecutive same suit),
joker substitution, and lay-offs onto existing melds.
"""

from itertools import combinations
from game.deck import Card, RANK_ORDER, RANKS, SUITS


def is_valid_set(cards: list[Card]) -> bool:
    """Check if cards form a valid set (3-4 of same rank, jokers allowed)."""
    if len(cards) < 3 or len(cards) > 4:
        return False

    jokers = [c for c in cards if c.is_joker]
    naturals = [c for c in cards if not c.is_joker]

    if len(jokers) > len(naturals):
        return False  # max 1 joker in set of 3, max 2 in set of 4

    if not naturals:
        return False

    # All naturals must be the same rank
    rank = naturals[0].rank
    if not all(c.rank == rank for c in naturals):
        return False

    # No duplicate suits among naturals
    suits = [c.suit for c in naturals]
    if len(suits) != len(set(suits)):
        return False

    return True


def is_valid_run(cards: list[Card]) -> bool:
    """Check if cards form a valid run (3+ consecutive, same suit, jokers fill gaps)."""
    if len(cards) < 3:
        return False

    jokers = [c for c in cards if c.is_joker]
    naturals = [c for c in cards if not c.is_joker]

    if not naturals:
        return False

    # All naturals must be the same suit
    suit = naturals[0].suit
    if not all(c.suit == suit for c in naturals):
        return False

    # Get rank indices and sort
    indices = sorted(c.rank_index for c in naturals)

    # Check for duplicate ranks
    if len(indices) != len(set(indices)):
        return False

    # Count gaps that jokers need to fill
    jokers_available = len(jokers)
    min_idx = indices[0]
    max_idx = indices[-1]

    # The span must equal len(cards) - 1
    span = max_idx - min_idx
    if span + 1 > len(cards):
        return False  # not enough cards (even with jokers) to fill the span

    # Check that naturals + jokers cover the full span
    needed_jokers = (span + 1) - len(naturals)
    if needed_jokers < 0 or needed_jokers > jokers_available:
        return False

    # Also handle ace-low runs: A-2-3 (indices 0,1,2) works naturally
    # Ace-high: Q-K-A means indices 10,11,12,0 — need special handling
    # Try ace-high interpretation if ace is present
    if 0 in indices and max_idx >= 10:
        # Try treating ace as index 13 (after K)
        high_indices = sorted(13 if i == 0 else i for i in indices)
        high_span = high_indices[-1] - high_indices[0]
        high_needed = (high_span + 1) - len(naturals)
        if 0 <= high_needed <= jokers_available and high_span + 1 <= len(cards):
            return True

    return needed_jokers >= 0


def is_valid_meld(cards: list[Card]) -> bool:
    """Check if cards form either a valid set or run."""
    return is_valid_set(cards) or is_valid_run(cards)


def can_lay_off(card: Card, meld: list[Card]) -> bool:
    """Check if a card can be added to an existing meld while keeping it valid."""
    extended = meld + [card]
    return is_valid_meld(extended)


def find_all_possible_melds(hand: list[Card]) -> list[list[Card]]:
    """Find all valid meld combinations from a hand.

    Returns a list of possible melds (each meld is a list of cards).
    Considers sets of 3-4 and runs of 3+.
    """
    melds = []
    jokers = [c for c in hand if c.is_joker]
    naturals = [c for c in hand if not c.is_joker]

    # Find sets: group by rank
    by_rank: dict[str, list[Card]] = {}
    for c in naturals:
        by_rank.setdefault(c.rank, []).append(c)

    for rank, cards in by_rank.items():
        # Sets of 3 or 4 naturals
        if len(cards) >= 3:
            for combo in combinations(cards, 3):
                if is_valid_set(list(combo)):
                    melds.append(list(combo))
            if len(cards) >= 4:
                if is_valid_set(cards[:4]):
                    melds.append(cards[:4])

        # Sets with jokers
        if len(cards) >= 2 and jokers:
            for combo in combinations(cards, 2):
                candidate = list(combo) + [jokers[0]]
                if is_valid_set(candidate):
                    melds.append(candidate)

    # Find runs: group by suit, try consecutive sequences
    by_suit: dict[str, list[Card]] = {}
    for c in naturals:
        by_suit.setdefault(c.suit, []).append(c)

    for suit, cards in by_suit.items():
        sorted_cards = sorted(cards, key=lambda c: c.rank_index)
        n = len(sorted_cards)

        # Try all subsequences of length 3+
        for length in range(3, n + 1 + len(jokers)):
            for start in range(n):
                end = min(start + length, n)
                subset = sorted_cards[start:end]

                # Try with 0..len(jokers) jokers added
                for num_jokers in range(len(jokers) + 1):
                    if len(subset) + num_jokers < 3:
                        continue
                    candidate = subset + jokers[:num_jokers]
                    if is_valid_run(candidate) and candidate not in melds:
                        melds.append(candidate)

        # Check ace-high runs (e.g., Q-K-A)
        aces = [c for c in sorted_cards if c.rank == 'A']
        high_cards = [c for c in sorted_cards if c.rank_index >= 10]  # J, Q, K
        if aces and high_cards:
            for ace in aces:
                for length in range(2, len(high_cards) + 1):
                    for combo in combinations(high_cards, length):
                        candidate = list(combo) + [ace]
                        if is_valid_run(candidate) and candidate not in melds:
                            melds.append(candidate)
                        # With jokers
                        for nj in range(1, len(jokers) + 1):
                            candidate_j = list(combo) + [ace] + jokers[:nj]
                            if is_valid_run(candidate_j) and candidate_j not in melds:
                                melds.append(candidate_j)

    return melds


def find_layoff_options(hand: list[Card], table_melds: list[list[Card]]) -> list[tuple[Card, int]]:
    """Find all cards in hand that can be laid off onto existing table melds.

    Returns list of (card, meld_index) tuples.
    """
    options = []
    for card in hand:
        for i, meld in enumerate(table_melds):
            if can_lay_off(card, meld):
                options.append((card, i))
    return options
