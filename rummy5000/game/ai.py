"""AI opponent for Rummy 5000 with three difficulty tiers.

Easy   — draws from pile, melds immediately, discards highest deadweight.
Medium — uses discard pile strategically, holds partial melds, safe discards.
Hard   — card counting, optimal meld timing, strategic go-out decisions.
"""

from .deck import RANK_ORDER, Card
from .melds import can_lay_off, find_all_possible_melds, find_layoff_options
from .scoring import card_points, score_meld

# ── Standalone strategy functions (used by both AI and hint system) ──


def evaluate_discard_pickup(hand: list[Card], discard_pile: list[Card],
                            table_melds: list[list[Card]] | None = None,
                            max_depth: int = 5) -> tuple[int, float] | None:
    """Evaluate if picking from the discard pile is net-positive.

    Returns (card_index, net_value) for the best pickup, or None.
    """
    best_index = None
    best_value = 0.0

    for idx in range(max(0, len(discard_pile) - max_depth), len(discard_pile)):
        pickup_cards = discard_pile[idx:]
        target = pickup_cards[0]
        test_hand = hand + pickup_cards

        melds_after = find_all_possible_melds(test_hand)
        valid_after = [m for m in melds_after if target in m]
        if not valid_after:
            # Also check layoff onto table melds
            if table_melds and any(can_lay_off(target, m) for m in table_melds):
                # Layoff is worth the target card's points minus deadweight
                layoff_value = card_points(target)
                deadweight = sum(card_points(c) for c in pickup_cards if c != target)
                net = layoff_value - deadweight
                if net > best_value and net > 15:
                    best_value = net
                    best_index = idx
            continue

        best_new_meld = max(valid_after, key=lambda m: score_meld(m))
        meld_value = score_meld(best_new_meld)
        deadweight = sum(card_points(c) for c in pickup_cards if c not in best_new_meld)

        net = meld_value - deadweight
        if net > best_value and net > 15:
            best_value = net
            best_index = idx

    if best_index is not None:
        return (best_index, best_value)
    return None


def partial_meld_value(card: Card, hand: list[Card]) -> float:
    """How valuable is this card as part of a partial (incomplete) meld?"""
    if card.is_joker:
        return 10

    value = 0.0
    # Count same-rank cards (partial set)
    same_rank = sum(1 for c in hand if c.rank == card.rank and not c.is_joker)
    if same_rank >= 2:
        value += 4  # pair — one card from a set

    # Count adjacent same-suit cards (partial run)
    same_suit = [c for c in hand if c.suit == card.suit and not c.is_joker]
    for c in same_suit:
        if c != card and abs(c.rank_index - card.rank_index) <= 2:
            value += 3  # adjacent or one-gap

    return value


def discard_danger_score(card: Card, opponent_picked_ids: list[str]) -> float:
    """Estimate how dangerous discarding this card is for the opponent."""
    if card.is_joker:
        return 10  # never discard jokers

    danger = 0.0
    for pid in opponent_picked_ids:
        if pid.startswith('joker'):
            continue
        picked_rank = pid[:-1]
        picked_suit_initial = pid[-1]
        if picked_rank == card.rank:
            danger += 3  # same rank — might complete a set
        if picked_suit_initial == card.suit[0]:
            if picked_rank in RANK_ORDER and card.rank in RANK_ORDER:
                gap = abs(RANK_ORDER[picked_rank] - RANK_ORDER[card.rank])
                if gap <= 2:
                    danger += 2  # nearby same suit — might extend a run

    return danger


def discard_danger_from_table(card: Card, table_melds: list[list[Card]]) -> float:
    """Simplified danger score based on public table melds (no tracking needed).

    Checks if the opponent could lay off this card onto existing table melds.
    """
    if card.is_joker:
        return 10
    danger = 0.0
    for meld in table_melds:
        if can_lay_off(card, meld):
            danger += 5  # opponent could use this card
    return danger


class AIPlayer:
    """AI decision maker that operates through a GameEngine instance."""

    def __init__(self, difficulty: str = 'medium'):
        self.difficulty = difficulty
        # Card tracking for hard mode: set of card IDs known to be unavailable
        self.known_cards: set[str] = set()
        # Cards the player has picked up from discard (hard mode tracking)
        self.player_picked: list[str] = []

    def reset_round(self):
        self.known_cards = set()
        self.player_picked = []

    def observe_discard(self, card: Card):
        """Track a card that was discarded (visible information)."""
        self.known_cards.add(card.id)

    def observe_player_pickup(self, cards: list[Card]):
        """Track cards the player picked up from discard pile."""
        for c in cards:
            self.player_picked.append(c.id)
            self.known_cards.discard(c.id)

    def observe_meld(self, cards: list[Card]):
        """Track cards that were melded (visible on table)."""
        for c in cards:
            self.known_cards.add(c.id)

    def take_turn(self, engine) -> list[dict]:
        """Execute a full AI turn and return action log for animation.

        Returns a list of action dicts: [{type, ...}, ...]
        """
        actions = []

        # 1. Draw phase
        draw_action = self._decide_draw(engine)
        actions.append(draw_action)
        self._execute_draw(engine, draw_action)

        # 2. Meld phase (may meld multiple times)
        meld_actions = self._decide_melds(engine)
        for ma in meld_actions:
            actions.append(ma)
            self._execute_meld(engine, ma)

        # 3. Layoff phase
        layoff_actions = self._decide_layoffs(engine)
        for la in layoff_actions:
            actions.append(la)
            self._execute_layoff(engine, la)

        # 4. Discard phase
        if engine.ai.hand:
            discard_action = self._decide_discard(engine)
            actions.append(discard_action)
            self._execute_discard(engine, discard_action)

        return actions

    # ── Draw decision ──────────────────────────────────

    def _decide_draw(self, engine) -> dict:
        if self.difficulty == 'easy':
            return {'type': 'draw', 'source': 'draw_pile'}

        if not engine.discard_pile:
            return {'type': 'draw', 'source': 'draw_pile'}

        hand = engine.ai.hand
        top_card = engine.discard_pile[-1]

        if self.difficulty == 'medium':
            # Pick up only if top card directly completes a meld
            test_hand = hand + [top_card]
            melds_with = find_all_possible_melds(test_hand)
            melds_with_top = [m for m in melds_with if top_card in m]
            if melds_with_top:
                return {'type': 'draw', 'source': 'discard_pile',
                        'card_index': len(engine.discard_pile) - 1}
            return {'type': 'draw', 'source': 'draw_pile'}

        # Hard mode: evaluate deeper discard pickups
        best_pickup = self._evaluate_discard_pickup(engine)
        if best_pickup is not None:
            return {'type': 'draw', 'source': 'discard_pile',
                    'card_index': best_pickup}

        return {'type': 'draw', 'source': 'draw_pile'}

    def _evaluate_discard_pickup(self, engine) -> int | None:
        """Hard mode: evaluate if picking from discard is net-positive."""
        table_melds = engine.player.melds + engine.ai.melds
        result = evaluate_discard_pickup(engine.ai.hand, engine.discard_pile, table_melds)
        return result[0] if result else None

    # ── Meld decision ──────────────────────────────────

    def _decide_melds(self, engine) -> list[dict]:
        hand = engine.ai.hand
        possible = find_all_possible_melds(hand)

        if not possible:
            return []

        if self.difficulty == 'easy':
            # Meld everything possible immediately
            return self._greedy_melds(hand, possible)

        if self.difficulty == 'medium':
            # Meld if value >= 15 or hand is getting large
            return self._selective_melds(hand, possible, threshold=15)

        # Hard: strategic meld timing
        return self._strategic_melds(engine, hand, possible)

    def _greedy_melds(self, hand: list[Card], possible: list[list[Card]]) -> list[dict]:
        """Meld all possible combinations greedily (largest first)."""
        actions = []
        used = set()
        sorted_melds = sorted(possible, key=lambda m: score_meld(m), reverse=True)

        for meld in sorted_melds:
            card_ids = frozenset(c.id for c in meld)
            if card_ids & used:
                continue
            # Verify all cards still in hand
            if all(c.id not in used and c in hand for c in meld):
                used |= card_ids
                actions.append({
                    'type': 'meld',
                    'cards': [c.to_dict() for c in meld],
                    'card_ids': [c.id for c in meld],
                })
        return actions

    def _selective_melds(self, hand, possible, threshold=15):
        """Meld only high-value combinations or when hand is large."""
        actions = []
        used = set()
        sorted_melds = sorted(possible, key=lambda m: score_meld(m), reverse=True)

        for meld in sorted_melds:
            card_ids = frozenset(c.id for c in meld)
            if card_ids & used:
                continue
            value = score_meld(meld)
            if value >= threshold or len(hand) > 10:
                if all(c in hand for c in meld):
                    used |= card_ids
                    actions.append({
                        'type': 'meld',
                        'cards': [c.to_dict() for c in meld],
                        'card_ids': [c.id for c in meld],
                    })
        return actions

    def _strategic_melds(self, engine, hand, possible):
        """Hard mode: hold melds when strategically advantageous."""
        # If close to going out, meld everything
        hand_value = sum(card_points(c) for c in hand)
        if hand_value <= 30 or len(hand) <= 4:
            return self._greedy_melds(hand, possible)

        # Otherwise meld high-value combos but hold low ones that might grow
        return self._selective_melds(hand, possible, threshold=20)

    # ── Layoff decision ────────────────────────────────

    def _decide_layoffs(self, engine) -> list[dict]:
        if self.difficulty == 'easy':
            return []  # Easy AI never lays off

        all_melds = engine.player.melds + engine.ai.melds
        if not all_melds:
            return []

        options = find_layoff_options(engine.ai.hand, all_melds)
        actions = []

        for card, meld_idx in options:
            if card in engine.ai.hand:
                points = card_points(card)
                # Medium: lay off if reduces deadweight by 10+
                if self.difficulty == 'medium' and points < 10:
                    continue
                actions.append({
                    'type': 'layoff',
                    'card': card.to_dict(),
                    'card_id': card.id,
                    'meld_index': meld_idx,
                })

        return actions

    # ── Discard decision ───────────────────────────────

    def _decide_discard(self, engine) -> dict:
        hand = engine.ai.hand
        if not hand:
            return {'type': 'discard', 'card': None}

        if self.difficulty == 'easy':
            # Discard highest value card
            worst = max(hand, key=lambda c: c.point_value)
            return {'type': 'discard', 'card': worst.to_dict(), 'card_id': worst.id}

        if self.difficulty == 'medium':
            return self._safe_discard(engine, hand)

        # Hard mode
        return self._optimal_discard(engine, hand)

    def _safe_discard(self, engine, hand):
        """Medium: avoid discarding cards adjacent to player's recent picks."""
        candidates = []
        for card in hand:
            danger = self._discard_danger(card, engine)
            candidates.append((card, card.point_value - danger * 5))

        # Discard the card with highest adjusted value (high points, low danger)
        candidates.sort(key=lambda x: x[1], reverse=True)
        choice = candidates[0][0]
        return {'type': 'discard', 'card': choice.to_dict(), 'card_id': choice.id}

    def _optimal_discard(self, engine, hand):
        """Hard: score each candidate by danger to opponent + deadweight value."""
        candidates = []
        for card in hand:
            # Check if card is part of a partial meld we're building
            partial_value = self._partial_meld_value(card, hand)
            danger = self._discard_danger(card, engine)
            # Score: high deadweight + low danger + low partial value = good discard
            score = card.point_value * 2 - danger * 8 - partial_value * 3
            candidates.append((card, score))

        candidates.sort(key=lambda x: x[1], reverse=True)
        choice = candidates[0][0]
        return {'type': 'discard', 'card': choice.to_dict(), 'card_id': choice.id}

    def _discard_danger(self, card: Card, engine) -> float:
        """Estimate how dangerous discarding this card is for the opponent."""
        return discard_danger_score(card, self.player_picked)

    def _partial_meld_value(self, card: Card, hand: list[Card]) -> float:
        """How valuable is this card as part of a partial (incomplete) meld?"""
        return partial_meld_value(card, hand)

    # ── Execution helpers ──────────────────────────────

    def _execute_draw(self, engine, action):
        if action['source'] == 'draw_pile':
            engine.ai_draw_from_pile()
        else:
            engine.ai_pickup_from_discard(action['card_index'])

    def _execute_meld(self, engine, action):
        cards = [c for c in engine.ai.hand if c.id in action['card_ids']]
        engine.ai_meld(cards)

    def _execute_layoff(self, engine, action):
        card = next((c for c in engine.ai.hand if c.id == action['card_id']), None)
        if card:
            engine.ai_layoff(card, action['meld_index'])

    def _execute_discard(self, engine, action):
        card_id = action.get('card_id')
        card = next((c for c in engine.ai.hand if c.id == card_id), None) if card_id else None
        # Always discard something to avoid deadlocking in AI_TURN
        engine.ai_discard(card)
