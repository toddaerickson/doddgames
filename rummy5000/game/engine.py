"""Game engine — state machine, turn logic, round flow for Rummy 5000.

State machine:
  DEALING → PLAYER_DRAW → PLAYER_MELD_OR_DISCARD → AI_TURN → PLAYER_DRAW → ...
  → ROUND_END → SCORING → NEXT_ROUND or GAME_OVER

The engine is the single source of truth for game state. Every player action
is validated here before being applied. The AI module calls engine methods
through the same interface as the player.
"""

import json
import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from .deck import Card, Deck
from .melds import is_valid_meld, can_lay_off, find_all_possible_melds, find_layoff_options
from .scoring import calculate_round_score, score_meld


class Phase(str, Enum):
    DEALING = 'dealing'
    PLAYER_DRAW = 'player_draw'
    PLAYER_MELD_OR_DISCARD = 'player_meld_or_discard'
    AI_TURN = 'ai_turn'
    ROUND_END = 'round_end'
    GAME_OVER = 'game_over'


class GameError(Exception):
    """Raised when an invalid game action is attempted."""
    pass


@dataclass
class PlayerState:
    hand: list[Card] = field(default_factory=list)
    melds: list[list[Card]] = field(default_factory=list)
    round_score: int = 0
    total_score: int = 0

    def to_dict(self, hide_hand: bool = False) -> dict:
        return {
            'hand': [c.to_dict() for c in self.hand] if not hide_hand else [],
            'hand_count': len(self.hand),
            'melds': [[c.to_dict() for c in m] for m in self.melds],
            'round_score': self.round_score,
            'total_score': self.total_score,
        }


class GameEngine:
    """Core game engine managing state for a full Rummy 5000 game."""

    HAND_SIZE = 7  # cards dealt per player

    def __init__(self, difficulty: str = 'medium', target_score: int = 5000):
        self.difficulty = difficulty
        self.target_score = target_score
        self.phase = Phase.DEALING
        self.deck = Deck()
        self.discard_pile: list[Card] = []
        self.player = PlayerState()
        self.ai = PlayerState()
        self.round_number = 0
        self.round_history: list[dict] = []
        # Track what was drawn from discard this turn (can't discard it back)
        self._drawn_from_discard: Optional[Card] = None
        # Track if player has melded the required card after picking up from discard
        self._must_meld_card: Optional[Card] = None
        self._game_over = False

    def new_round(self):
        """Deal a new round."""
        self.round_number += 1
        self.phase = Phase.DEALING
        self.deck = Deck()
        self.deck.shuffle()
        self.discard_pile = []
        self.player.hand = []
        self.player.melds = []
        self.player.round_score = 0
        self.ai.hand = []
        self.ai.melds = []
        self.ai.round_score = 0
        self._drawn_from_discard = None
        self._must_meld_card = None

        # Deal
        self.player.hand = self.deck.deal(self.HAND_SIZE)
        self.ai.hand = self.deck.deal(self.HAND_SIZE)

        # Flip first discard
        first_discard = self.deck.draw()
        if first_discard:
            self.discard_pile.append(first_discard)

        self.phase = Phase.PLAYER_DRAW

    # ── Player actions ─────────────────────────────────

    def player_draw_from_pile(self) -> Card:
        """Player draws the top card from the draw pile."""
        if self.phase != Phase.PLAYER_DRAW:
            raise GameError("Not in draw phase")

        card = self.deck.draw()
        if card is None:
            # Draw pile exhausted — end round
            self._end_round('draw_exhausted')
            raise GameError("Draw pile exhausted — round ended")

        self.player.hand.append(card)
        self._drawn_from_discard = None
        self._must_meld_card = None
        self.phase = Phase.PLAYER_MELD_OR_DISCARD
        return card

    def player_pickup_from_discard(self, card_index: int) -> list[Card]:
        """Player picks up from the discard pile at the given index.

        Must take all cards from that index to the top. The chosen card
        must be immediately melded (tracked via _must_meld_card).
        """
        if self.phase != Phase.PLAYER_DRAW:
            raise GameError("Not in draw phase")

        if card_index < 0 or card_index >= len(self.discard_pile):
            raise GameError("Invalid discard pile index")

        # Take cards from index to top (end of list)
        picked_up = self.discard_pile[card_index:]
        self.discard_pile = self.discard_pile[:card_index]

        # The targeted card must be melded this turn
        target_card = picked_up[0]
        self._must_meld_card = target_card
        self._drawn_from_discard = target_card

        self.player.hand.extend(picked_up)
        self.phase = Phase.PLAYER_MELD_OR_DISCARD
        return picked_up

    def player_meld(self, card_ids: list[str]) -> list[Card]:
        """Player lays down a meld from their hand."""
        if self.phase != Phase.PLAYER_MELD_OR_DISCARD:
            raise GameError("Not in meld/discard phase")

        if len(card_ids) < 3:
            raise GameError("A meld requires at least 3 cards")

        # Find cards in hand
        cards = self._find_cards_in_hand(self.player, card_ids)
        if not is_valid_meld(cards):
            raise GameError("Invalid meld — not a valid set or run")

        # Remove from hand, add to melds
        for card in cards:
            self.player.hand.remove(card)
        self.player.melds.append(cards)

        # Check if must-meld card was included
        if self._must_meld_card and self._must_meld_card in cards:
            self._must_meld_card = None

        # Check if player went out
        if not self.player.hand:
            self._end_round('player')
            return cards

        return cards

    def player_layoff(self, card_id: str, meld_index: int) -> Card:
        """Player lays off a single card onto an existing meld."""
        if self.phase != Phase.PLAYER_MELD_OR_DISCARD:
            raise GameError("Not in meld/discard phase")

        # Collect all table melds (player's + AI's)
        all_melds = self.player.melds + self.ai.melds
        if meld_index < 0 or meld_index >= len(all_melds):
            raise GameError("Invalid meld index")

        cards = self._find_cards_in_hand(self.player, [card_id])
        card = cards[0]
        target_meld = all_melds[meld_index]

        # Validate BEFORE mutating state
        if not can_lay_off(card, target_meld):
            raise GameError("Card cannot be laid off on this meld")

        # Now safe to mutate
        self.player.hand.remove(card)
        target_meld.append(card)

        # Check if must-meld card was laid off
        if self._must_meld_card and self._must_meld_card == card:
            self._must_meld_card = None

        if not self.player.hand:
            self._end_round('player')

        return card

    def player_discard(self, card_id: str) -> Card:
        """Player discards a card to end their turn."""
        if self.phase != Phase.PLAYER_MELD_OR_DISCARD:
            raise GameError("Not in meld/discard phase")

        # Must meld the pickup card before discarding
        if self._must_meld_card is not None:
            raise GameError("You must meld the card you picked up from the discard pile first")

        cards = self._find_cards_in_hand(self.player, [card_id])
        card = cards[0]

        # Can't discard the card just drawn from discard pile
        if self._drawn_from_discard and card == self._drawn_from_discard:
            raise GameError("Cannot discard the card you just picked up from the discard pile")

        self.player.hand.remove(card)
        self.discard_pile.append(card)
        self._drawn_from_discard = None
        self._must_meld_card = None

        # Check if player went out (discarded last card)
        if not self.player.hand:
            self._end_round('player')
            return card

        self.phase = Phase.AI_TURN
        return card

    def player_sort_hand(self, by: str = 'rank'):
        """Sort the player's hand by rank or suit."""
        if by == 'suit':
            suit_order = {'hearts': 0, 'diamonds': 1, 'clubs': 2, 'spades': 3}
            self.player.hand.sort(
                key=lambda c: (2 if c.is_joker else suit_order.get(c.suit, 4), c.rank_index)
            )
        else:
            self.player.hand.sort(
                key=lambda c: (1 if c.is_joker else 0, c.rank_index)
            )

    # ── AI actions (called by ai module) ───────────────

    def ai_draw_from_pile(self) -> Optional[Card]:
        if self.phase not in (Phase.AI_TURN, Phase.PLAYER_DRAW):
            return None
        card = self.deck.draw()
        if card is None:
            self._end_round('draw_exhausted')
            return None
        self.ai.hand.append(card)
        return card

    def ai_pickup_from_discard(self, card_index: int) -> list[Card]:
        if self.phase not in (Phase.AI_TURN, Phase.PLAYER_DRAW):
            return []
        if card_index < 0 or card_index >= len(self.discard_pile):
            return []
        picked_up = self.discard_pile[card_index:]
        self.discard_pile = self.discard_pile[:card_index]
        self.ai.hand.extend(picked_up)
        return picked_up

    def ai_meld(self, cards: list[Card]) -> bool:
        if self.phase in (Phase.ROUND_END, Phase.GAME_OVER):
            return False
        if not is_valid_meld(cards):
            return False
        for card in cards:
            if card in self.ai.hand:
                self.ai.hand.remove(card)
        self.ai.melds.append(cards)
        return True

    def ai_layoff(self, card: Card, meld_index: int) -> bool:
        if self.phase in (Phase.ROUND_END, Phase.GAME_OVER):
            return False
        all_melds = self.player.melds + self.ai.melds
        if meld_index < 0 or meld_index >= len(all_melds):
            return False
        if not can_lay_off(card, all_melds[meld_index]):
            return False
        if card in self.ai.hand:
            self.ai.hand.remove(card)
        all_melds[meld_index].append(card)
        return True

    def ai_discard(self, card: Card):
        if self.phase in (Phase.ROUND_END, Phase.GAME_OVER):
            return
        if card in self.ai.hand:
            self.ai.hand.remove(card)
        self.discard_pile.append(card)
        if not self.ai.hand:
            self._end_round('ai')
        else:
            self.phase = Phase.PLAYER_DRAW

    # ── Round management ───────────────────────────────

    def _end_round(self, went_out: str):
        """End the current round, calculate scores."""
        self.phase = Phase.ROUND_END

        p_result = calculate_round_score(self.player.melds, self.player.hand)
        a_result = calculate_round_score(self.ai.melds, self.ai.hand)

        self.player.round_score = p_result['net']
        self.ai.round_score = a_result['net']
        self.player.total_score += p_result['net']
        self.ai.total_score += a_result['net']

        self.round_history.append({
            'round': self.round_number,
            'went_out': went_out,
            'player': p_result,
            'ai': a_result,
            'player_total': self.player.total_score,
            'ai_total': self.ai.total_score,
        })

        # Check for game over
        if self.player.total_score >= self.target_score or self.ai.total_score >= self.target_score:
            self.phase = Phase.GAME_OVER
            self._game_over = True

    def get_winner(self) -> Optional[str]:
        if not self._game_over:
            return None
        if self.player.total_score >= self.target_score and self.ai.total_score >= self.target_score:
            return 'player' if self.player.total_score > self.ai.total_score else 'ai'
        if self.player.total_score >= self.target_score:
            return 'player'
        if self.ai.total_score >= self.target_score:
            return 'ai'
        return None

    # ── Hint ───────────────────────────────────────────

    def get_hint(self) -> dict:
        """Suggest the best action for the current phase."""
        if self.phase == Phase.PLAYER_DRAW:
            # Check if top discard helps complete a meld
            if self.discard_pile:
                top = self.discard_pile[-1]
                test_hand = self.player.hand + [top]
                melds = find_all_possible_melds(test_hand)
                has_meld_with_top = any(top in m for m in melds)
                if has_meld_with_top:
                    return {'action': 'pickup', 'message': f'Pick up {top} — it completes a meld!'}
            return {'action': 'draw', 'message': 'Draw from the pile.'}

        if self.phase == Phase.PLAYER_MELD_OR_DISCARD:
            melds = find_all_possible_melds(self.player.hand)
            if melds:
                best = max(melds, key=lambda m: score_meld(m))
                card_ids = [c.id for c in best]
                return {'action': 'meld', 'cards': card_ids,
                        'message': f'Meld: {" ".join(str(c) for c in best)}'}

            # Find worst card to discard
            if self.player.hand:
                worst = max(self.player.hand, key=lambda c: c.point_value)
                return {'action': 'discard', 'card': worst.id,
                        'message': f'Discard {worst} (highest deadweight).'}

        return {'message': 'No hint available.'}

    # ── Helpers ────────────────────────────────────────

    def _find_cards_in_hand(self, player: PlayerState, card_ids: list[str]) -> list[Card]:
        """Find cards in a player's hand by their IDs."""
        cards = []
        for cid in card_ids:
            found = next((c for c in player.hand if c.id == cid), None)
            if found is None:
                raise GameError(f"Card {cid} not found in hand")
            cards.append(found)
        return cards

    def get_valid_actions(self) -> list[str]:
        """Return list of valid action names for the current phase."""
        if self.phase == Phase.PLAYER_DRAW:
            actions = ['draw']
            if self.discard_pile:
                actions.append('pickup')
            return actions
        if self.phase == Phase.PLAYER_MELD_OR_DISCARD:
            actions = []
            if find_all_possible_melds(self.player.hand):
                actions.append('meld')
            all_melds = self.player.melds + self.ai.melds
            if all_melds and find_layoff_options(self.player.hand, all_melds):
                actions.append('layoff')
            if self._must_meld_card is None:
                actions.append('discard')
            return actions
        return []

    # ── Serialization ──────────────────────────────────

    def to_dict(self) -> dict:
        """Full game state for the frontend. AI hand is hidden."""
        all_melds = self.player.melds + self.ai.melds
        return {
            'phase': self.phase.value,
            'round_number': self.round_number,
            'difficulty': self.difficulty,
            'target_score': self.target_score,
            'player': self.player.to_dict(),
            'ai': self.ai.to_dict(hide_hand=True),
            'discard_pile': [c.to_dict() for c in self.discard_pile],
            'draw_pile_count': self.deck.remaining,
            'valid_actions': self.get_valid_actions(),
            'round_history': self.round_history,
            'must_meld': self._must_meld_card.id if self._must_meld_card else None,
            'game_over': self._game_over,
            'winner': self.get_winner(),
        }

    def to_json(self) -> str:
        """Serialize full state (including AI hand) for save/resume."""
        state = self.to_dict()
        state['ai']['hand'] = [c.to_dict() for c in self.ai.hand]
        state['deck_cards'] = [c.to_dict() for c in self.deck.cards]
        state['_drawn_from_discard'] = self._drawn_from_discard.id if self._drawn_from_discard else None
        state['_must_meld_card'] = self._must_meld_card.id if self._must_meld_card else None
        return json.dumps(state)
