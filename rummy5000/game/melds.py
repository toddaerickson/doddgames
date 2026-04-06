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


def _check_consecutive_run(indices: list[int], jokers_available: int, total_cards: int) -> bool:
    """Check if sorted rank indices form a consecutive run with joker gap-filling.

    Verifies that every position in the span is covered by either a natural
    card or a joker, and that total cards exactly fills the span.
    """
    if not indices:
        return False

    min_idx = indices[0]
    max_idx = indices[-1]
    span = max_idx - min_idx + 1

    # Total cards must exactly equal the span (no extras, no gaps)
    if span != total_cards:
        return False

    # Count how many positions in the span are NOT covered by naturals
    index_set = set(indices)
    gaps = sum(1 for pos in range(min_idx, max_idx + 1) if pos not in index_set)

    return gaps <= jokers_available and gaps == total_cards - len(indices)


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

    jokers_available = len(jokers)

    # Try ace-low interpretation (A=0): works naturally
    if _check_consecutive_run(indices, jokers_available, len(cards)):
        return True

    # Try ace-high interpretation (A=13) if ace is present
    if 0 in indices:
        high_indices = sorted(13 if i == 0 else i for i in indices)
        if _check_consecutive_run(high_indices, jokers_available, len(cards)):
            return True

    return False


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
    Uses frozenset of card IDs for O(1) duplicate detection.
    """
    melds = []
    seen: set[frozenset[str]] = set()
    jokers = [c for c in hand if c.is_joker]
    naturals = [c for c in hand if not c.is_joker]

    def _add_meld(candidate: list[Card]):
        key = frozenset(c.id for c in candidate)
        if key not in seen and is_valid_meld(candidate):
            seen.add(key)
            melds.append(candidate)

    # Find sets: group by rank
    by_rank: dict[str, list[Card]] = {}
    for c in naturals:
        by_rank.setdefault(c.rank, []).append(c)

    for rank, cards in by_rank.items():
        # Sets of 3 or 4 naturals
        if len(cards) >= 3:
            for combo in combinations(cards, 3):
                _add_meld(list(combo))
            for combo in combinations(cards, 4):
                _add_meld(list(combo))

        # Sets with jokers
        if len(cards) >= 2 and jokers:
            for combo in combinations(cards, 2):
                for nj in range(1, len(jokers) + 1):
                    candidate = list(combo) + jokers[:nj]
                    if len(candidate) <= 4:
                        _add_meld(candidate)

    # Find runs: group by suit, try consecutive sequences
    by_suit: dict[str, list[Card]] = {}
    for c in naturals:
        by_suit.setdefault(c.suit, []).append(c)

    for suit, cards in by_suit.items():
        sorted_cards = sorted(cards, key=lambda c: c.rank_index)
        n = len(sorted_cards)

        # Try all contiguous subsequences of the sorted cards + jokers
        for start in range(n):
            for end in range(start + 1, n + 1):
                subset = sorted_cards[start:end]
                # Try with 0..len(jokers) jokers
                for num_jokers in range(len(jokers) + 1):
                    candidate = subset + jokers[:num_jokers]
                    if len(candidate) >= 3:
                        _add_meld(candidate)

        # Ace-high runs (e.g., Q-K-A): ace is at index 0 in sorted order
        # but needs to be tried at the high end
        aces = [c for c in sorted_cards if c.rank == 'A']
        high_cards = [c for c in sorted_cards if c.rank_index >= 10]  # J, Q, K
        if aces and high_cards:
            for ace in aces:
                for length in range(1, len(high_cards) + 1):
                    for combo in combinations(high_cards, length):
                        candidate = list(combo) + [ace]
                        if len(candidate) >= 3:
                            _add_meld(candidate)
                        # With jokers
                        for nj in range(1, len(jokers) + 1):
                            candidate_j = list(combo) + [ace] + jokers[:nj]
                            if len(candidate_j) >= 3:
                                _add_meld(candidate_j)

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
