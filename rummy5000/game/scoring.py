"""Scoring logic for Rummy 5000.

Card values:
  Joker       = 50 points
  Ace (high)  = 15 points (in a set, or in Q-K-A run)
  Ace (low)   = 5 points  (in A-2-3 run)
  K, Q, J     = 10 points
  2–10        = face value
"""

from game.deck import Card


def card_points(card: Card, in_low_run: bool = False) -> int:
    """Point value of a single card.

    Args:
        card: The card to score.
        in_low_run: If True and card is an Ace, score as 5 instead of 15.
    """
    if card.is_joker:
        return 50
    if card.rank == 'A':
        return 5 if in_low_run else 15
    if card.rank in ('J', 'Q', 'K'):
        return 10
    return int(card.rank)


def _is_low_ace_run(meld: list[Card]) -> bool:
    """Check if meld is a run containing A-2-3 (ace used as low)."""
    naturals = [c for c in meld if not c.is_joker]
    if not naturals:
        return False

    ranks = {c.rank for c in naturals}
    # Ace is low if 2 or 3 is in the run but Q and K are not
    if 'A' in ranks and ('2' in ranks or '3' in ranks):
        if 'K' not in ranks and 'Q' not in ranks:
            return True
    return False


def score_meld(meld: list[Card]) -> int:
    """Calculate point value of a single meld."""
    low_run = _is_low_ace_run(meld)
    total = 0
    for card in meld:
        if card.rank == 'A' and low_run:
            total += card_points(card, in_low_run=True)
        else:
            total += card_points(card)
    return total


def score_melds(melds: list[list[Card]]) -> int:
    """Total point value of all melds."""
    return sum(score_meld(m) for m in melds)


def score_hand(hand: list[Card]) -> int:
    """Penalty points for cards remaining in hand (unmelded)."""
    return sum(card_points(c) for c in hand)


def calculate_round_score(melds: list[list[Card]], hand: list[Card]) -> dict:
    """Calculate a player's net score for a round.

    Returns:
        dict with meld_points, hand_penalty, and net score.
    """
    meld_pts = score_melds(melds)
    hand_pts = score_hand(hand)
    return {
        'meld_points': meld_pts,
        'hand_penalty': hand_pts,
        'net': meld_pts - hand_pts,
    }
