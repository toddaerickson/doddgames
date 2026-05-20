"""Game engine — state machine, turn logic, round flow for Rummy 5000.

State machine:
  DEALING → PLAYER_DRAW → PLAYER_MELD_OR_DISCARD → AI_TURN → PLAYER_DRAW → ...
  → ROUND_END → SCORING → NEXT_ROUND or GAME_OVER

The engine is the single source of truth for game state. Every player action
is validated here before being applied. The AI module calls engine methods
through the same interface as the player.
"""

import json
from dataclasses import dataclass, field
from enum import Enum

from .ai import discard_danger_from_table, evaluate_discard_pickup, partial_meld_value
from .deck import Card, Deck
from .melds import can_lay_off, can_meld_card, find_all_possible_melds, find_layoff_options, is_valid_meld
from .scoring import calculate_round_score, card_points, score_meld


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
        self._drawn_from_discard: Card | None = None
        # Track if player has melded the required card after picking up from discard
        self._must_meld_card: Card | None = None
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

        # Preview the pickup before mutating state
        picked_up = self.discard_pile[card_index:]
        target_card = picked_up[0]

        # Pre-validate: the target card must be meldable with the resulting hand
        test_hand = self.player.hand + picked_up
        all_table_melds = self.player.melds + self.ai.melds
        if not can_meld_card(target_card, test_hand, all_table_melds):
            raise GameError(f"Cannot pick up {target_card} — no valid meld or layoff possible")

        # Validation passed — mutate state
        self.discard_pile = self.discard_pile[:card_index]
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

        # Check before mutate: if must-meld card is NOT in this meld,
        # verify remaining hand can still satisfy the obligation
        if self._must_meld_card and self._must_meld_card not in cards:
            remaining = [c for c in self.player.hand if c not in cards]
            # Include the new meld in table melds for layoff checking
            all_table_melds = self.player.melds + self.ai.melds + [cards]
            if not can_meld_card(self._must_meld_card, remaining, all_table_melds):
                raise GameError(
                    "This meld would make it impossible to use the required pickup card"
                )

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

        # Check before mutate: if must-meld card is set and this isn't it,
        # verify remaining hand can still satisfy the obligation
        if self._must_meld_card and self._must_meld_card != card:
            remaining = [c for c in self.player.hand if c.id != card_id]
            # Simulate the table melds after this layoff
            table_after = self.player.melds + self.ai.melds
            if not can_meld_card(self._must_meld_card, remaining, table_after):
                raise GameError(
                    "This layoff would make it impossible to use the required pickup card"
                )

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

    def ai_draw_from_pile(self) -> Card | None:
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
        # Validate ALL cards are in hand before removing any
        if not all(card in self.ai.hand for card in cards):
            return False
        for card in cards:
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
        if card not in self.ai.hand:
            return False
        self.ai.hand.remove(card)
        all_melds[meld_index].append(card)
        return True

    def ai_discard(self, card: Card):
        if self.phase in (Phase.ROUND_END, Phase.GAME_OVER):
            return
        if card is None or card not in self.ai.hand:
            # Fallback: discard first card in hand to avoid deadlock
            if self.ai.hand:
                card = self.ai.hand[0]
            else:
                self.phase = Phase.PLAYER_DRAW
                return
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

    def get_winner(self) -> str | None:
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
        """Suggest the best action for the current phase.

        Balances offensive (meld value, go-out, deep pickups) and defensive
        (danger scoring, partial meld preservation) strategy.
        """
        hand = self.player.hand
        table_melds = self.player.melds + self.ai.melds

        if self.phase == Phase.PLAYER_DRAW:
            return self._hint_draw(hand, table_melds)

        if self.phase == Phase.PLAYER_MELD_OR_DISCARD:
            return self._hint_meld_or_discard(hand, table_melds)

        return {'message': 'No hint available.'}

    def _hint_draw(self, hand, table_melds) -> dict:
        """Hint for draw phase: evaluate deep discard pickups, not just top card."""
        if self.discard_pile:
            # Offensive: evaluate deeper discard pile pickups
            result = evaluate_discard_pickup(hand, self.discard_pile, table_melds)
            if result:
                idx, net_value = result
                target = self.discard_pile[idx]
                num_cards = len(self.discard_pile) - idx
                if num_cards > 1:
                    return {
                        'action': 'pickup',
                        'message': f'Pick up {num_cards} cards down to {target} — '
                                   f'nets ~{int(net_value)} points in melds!',
                    }
                return {
                    'action': 'pickup',
                    'message': f'Pick up {target} — it completes a meld!',
                }

            # Fallback: check if just the top card completes a meld
            top = self.discard_pile[-1]
            test_hand = hand + [top]
            melds = find_all_possible_melds(test_hand)
            if any(top in m for m in melds):
                return {
                    'action': 'pickup',
                    'message': f'Pick up {top} — it completes a meld!',
                }

        return {'action': 'draw', 'message': 'Draw from the pile — nothing useful in the discard.'}

    def _hint_meld_or_discard(self, hand, table_melds) -> dict:
        """Hint for meld/discard phase: go-out detection, layoffs, strategic discard."""
        melds = find_all_possible_melds(hand)

        # Priority 1: Must-meld obligation — guide toward satisfying it
        if self._must_meld_card:
            must_melds = [m for m in melds if self._must_meld_card in m]
            if must_melds:
                best = max(must_melds, key=lambda m: score_meld(m))
                card_ids = [c.id for c in best]
                return {
                    'action': 'meld', 'cards': card_ids,
                    'message': f'Meld {" ".join(str(c) for c in best)} '
                               f'(includes your required pickup card).',
                }
            # Check layoff for must-meld card
            for i, meld in enumerate(table_melds):
                if can_lay_off(self._must_meld_card, meld):
                    return {
                        'action': 'layoff',
                        'card': self._must_meld_card.id,
                        'meld_index': i,
                        'message': f'Lay off {self._must_meld_card} onto a table meld '
                                   f'to satisfy your pickup obligation.',
                    }
            return {
                'message': f'You need to meld or lay off {self._must_meld_card} before discarding.',
            }

        # Priority 2: Can we go out?
        if melds and hand:
            for meld in sorted(melds, key=lambda m: score_meld(m), reverse=True):
                remaining = [c for c in hand if c not in meld]
                if len(remaining) == 1:
                    card_ids = [c.id for c in meld]
                    return {
                        'action': 'meld', 'cards': card_ids,
                        'message': f'Go out! Meld {" ".join(str(c) for c in meld)}, '
                                   f'then discard {remaining[0]}.',
                    }
                if len(remaining) == 0:
                    card_ids = [c.id for c in meld]
                    return {
                        'action': 'meld', 'cards': card_ids,
                        'message': f'Go out! Meld {" ".join(str(c) for c in meld)} to win the round!',
                    }

        # Priority 3: Suggest best meld (considering partial meld value of remaining hand)
        if melds:
            best = max(melds, key=lambda m: score_meld(m))
            meld_value = score_meld(best)
            remaining = [c for c in hand if c not in best]
            remaining_partial = sum(partial_meld_value(c, remaining) for c in remaining)
            card_ids = [c.id for c in best]

            # Offensive: suggest the meld
            msg = f'Meld {" ".join(str(c) for c in best)} ({meld_value} pts).'
            # If remaining hand has good partial melds, note the strategy
            if remaining_partial > 10 and len(remaining) > 3:
                msg += ' Your remaining cards have good meld potential — keep building!'
            return {'action': 'meld', 'cards': card_ids, 'message': msg}

        # Priority 4: Suggest layoffs
        layoffs = find_layoff_options(hand, table_melds)
        high_layoffs = [(c, i) for c, i in layoffs if card_points(c) >= 10]
        if high_layoffs:
            card, meld_idx = high_layoffs[0]
            return {
                'action': 'layoff',
                'card': card.id,
                'meld_index': meld_idx,
                'message': f'Lay off {card} ({card_points(card)} pts) to reduce your deadweight.',
            }

        # Priority 5: Smart discard — balance deadweight, danger, and partial value
        if hand:
            candidates = []
            for card in hand:
                pv = partial_meld_value(card, hand)
                danger = discard_danger_from_table(card, table_melds)
                # Score: high deadweight + low danger + low partial value = good discard
                score = card.point_value * 2 - danger * 8 - pv * 3
                candidates.append((card, score, pv, danger))

            candidates.sort(key=lambda x: x[1], reverse=True)
            best_card, _, pv, danger = candidates[0]

            reasons = []
            reasons.append(f'{card_points(best_card)} pts deadweight')
            if pv == 0:
                reasons.append('not part of any partial meld')
            if danger == 0:
                reasons.append('low danger to opponent')

            return {
                'action': 'discard',
                'card': best_card.id,
                'message': f'Discard {best_card} ({", ".join(reasons)}).',
            }

        return {'message': 'No hint available.'}

    # ── Helpers ────────────────────────────────────────

    def _find_cards_in_hand(self, player: PlayerState, card_ids: list[str]) -> list[Card]:
        """Find cards in a player's hand by their IDs."""
        cards = []
        used: set[int] = set()  # track by object id to prevent duplicates
        for cid in card_ids:
            found = next(
                (c for c in player.hand if c.id == cid and id(c) not in used),
                None,
            )
            if found is None:
                raise GameError(f"Card {cid} not found in hand")
            used.add(id(found))
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
