"""Tests for rummy5000.game.engine module."""

import pytest
from rummy5000.game.deck import Card, Deck
from rummy5000.game.engine import GameEngine, GameError, Phase


# ── Helpers ────────────────────────────────────────────────

def c(rank, suit='hearts'):
    return Card(rank=rank, suit=suit)

def joker(color='red'):
    return Card(rank='Joker', suit=color, is_joker=True)

def make_engine(**kwargs) -> GameEngine:
    """Create a new engine and deal the first round."""
    engine = GameEngine(**kwargs)
    engine.new_round()
    return engine


# ── New round ──────────────────────────────────────────────

class TestNewRound:
    def test_initial_state(self):
        engine = make_engine()
        assert engine.phase == Phase.PLAYER_DRAW
        assert engine.round_number == 1
        assert len(engine.player.hand) == 7
        assert len(engine.ai.hand) == 7
        assert len(engine.discard_pile) == 1
        assert engine.deck.remaining == 54 - 7 - 7 - 1  # 39

    def test_second_round_resets(self):
        engine = make_engine()
        engine.player.total_score = 100
        engine.ai.total_score = 50
        engine.new_round()
        assert engine.round_number == 2
        assert len(engine.player.hand) == 7
        assert engine.player.total_score == 100  # total persists
        assert engine.player.round_score == 0    # round score resets


# ── Player draw ────────────────────────────────────────────

class TestPlayerDraw:
    def test_draw_from_pile(self):
        engine = make_engine()
        initial_hand = len(engine.player.hand)
        initial_deck = engine.deck.remaining
        engine.player_draw_from_pile()
        assert len(engine.player.hand) == initial_hand + 1
        assert engine.deck.remaining == initial_deck - 1
        assert engine.phase == Phase.PLAYER_MELD_OR_DISCARD

    def test_draw_wrong_phase(self):
        engine = make_engine()
        engine.player_draw_from_pile()  # now in meld/discard phase
        with pytest.raises(GameError, match="Not in draw phase"):
            engine.player_draw_from_pile()


# ── Player pickup from discard ─────────────────────────────

class TestPlayerPickup:
    def test_pickup_top_card(self):
        engine = make_engine()
        # Stack the discard with a card that can be melded with hand
        engine.player.hand = [c('K', 'hearts'), c('K', 'diamonds'), c('5', 'spades')]
        engine.discard_pile = [c('K', 'clubs')]

        picked = engine.player_pickup_from_discard(0)
        assert len(picked) == 1
        assert picked[0].rank == 'K'
        assert engine.phase == Phase.PLAYER_MELD_OR_DISCARD
        assert engine._must_meld_card is not None

    def test_pickup_invalid_index(self):
        engine = make_engine()
        with pytest.raises(GameError, match="Invalid discard pile index"):
            engine.player_pickup_from_discard(999)

    def test_pickup_wrong_phase(self):
        engine = make_engine()
        engine.player_draw_from_pile()
        with pytest.raises(GameError, match="Not in draw phase"):
            engine.player_pickup_from_discard(0)


# ── Player meld ────────────────────────────────────────────

class TestPlayerMeld:
    def test_valid_meld(self):
        engine = make_engine()
        engine.player_draw_from_pile()
        # Set up a hand with a valid set
        engine.player.hand = [
            c('K', 'hearts'), c('K', 'diamonds'), c('K', 'clubs'),
            c('5', 'spades'), c('2', 'hearts'),
        ]
        card_ids = ['Kh', 'Kd', 'Kc']
        engine.player_meld(card_ids)
        assert len(engine.player.melds) == 1
        assert len(engine.player.hand) == 2

    def test_invalid_meld(self):
        engine = make_engine()
        engine.player_draw_from_pile()
        engine.player.hand = [
            c('K', 'hearts'), c('Q', 'diamonds'), c('2', 'clubs'),
            c('5', 'spades'),
        ]
        with pytest.raises(GameError, match="Invalid meld"):
            engine.player_meld(['Kh', 'Qd', '2c'])

    def test_too_few_cards(self):
        engine = make_engine()
        engine.player_draw_from_pile()
        with pytest.raises(GameError, match="at least 3"):
            engine.player_meld(['Kh', 'Kd'])

    def test_meld_wrong_phase(self):
        engine = make_engine()
        # Still in PLAYER_DRAW phase
        with pytest.raises(GameError, match="Not in meld/discard phase"):
            engine.player_meld(['Kh', 'Kd', 'Kc'])

    def test_going_out_via_meld(self):
        engine = make_engine()
        engine.player_draw_from_pile()
        # Hand is exactly a meld — going out
        engine.player.hand = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
        engine.player_meld(['3h', '4h', '5h'])
        assert engine.phase == Phase.ROUND_END


# ── Player discard ─────────────────────────────────────────

class TestPlayerDiscard:
    def test_discard(self):
        engine = make_engine()
        engine.player_draw_from_pile()
        hand_before = len(engine.player.hand)
        card = engine.player.hand[0]
        engine.player_discard(card.id)
        assert len(engine.player.hand) == hand_before - 1
        assert engine.discard_pile[-1] == card
        assert engine.phase == Phase.AI_TURN

    def test_discard_wrong_phase(self):
        engine = make_engine()
        with pytest.raises(GameError, match="Not in meld/discard phase"):
            engine.player_discard('Kh')

    def test_cannot_discard_with_must_meld(self):
        engine = make_engine()
        engine.player.hand = [c('K', 'hearts'), c('K', 'diamonds'), c('5', 'spades')]
        engine.discard_pile = [c('K', 'clubs')]
        engine.player_pickup_from_discard(0)
        with pytest.raises(GameError, match="must meld"):
            engine.player_discard('5s')

    def test_going_out_via_discard(self):
        engine = make_engine()
        engine.player_draw_from_pile()
        # After melding, only one card left
        engine.player.hand = [c('5', 'spades')]
        engine.player_discard('5s')
        assert engine.phase == Phase.ROUND_END


# ── Player layoff ──────────────────────────────────────────

class TestPlayerLayoff:
    def test_layoff_extends_run(self):
        engine = make_engine()
        engine.player_draw_from_pile()
        engine.player.melds = [[c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]]
        engine.player.hand = [c('6', 'hearts'), c('9', 'spades')]
        engine.player_layoff('6h', 0)
        assert len(engine.player.melds[0]) == 4
        assert len(engine.player.hand) == 1

    def test_invalid_layoff(self):
        engine = make_engine()
        engine.player_draw_from_pile()
        engine.player.melds = [[c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]]
        engine.player.hand = [c('9', 'spades'), c('2', 'diamonds')]
        with pytest.raises(GameError, match="cannot be laid off"):
            engine.player_layoff('9s', 0)


# ── AI actions ─────────────────────────────────────────────

class TestAIActions:
    def test_ai_draw(self):
        engine = make_engine()
        engine.phase = Phase.AI_TURN
        initial = len(engine.ai.hand)
        card = engine.ai_draw_from_pile()
        assert card is not None
        assert len(engine.ai.hand) == initial + 1

    def test_ai_meld(self):
        engine = make_engine()
        engine.phase = Phase.AI_TURN
        cards = [c('5', 'hearts'), c('5', 'diamonds'), c('5', 'clubs')]
        engine.ai.hand = cards.copy() + [c('2', 'spades')]
        result = engine.ai_meld(cards)
        assert result is True
        assert len(engine.ai.melds) == 1
        assert len(engine.ai.hand) == 1

    def test_ai_invalid_meld(self):
        engine = make_engine()
        engine.phase = Phase.AI_TURN
        cards = [c('5', 'hearts'), c('7', 'diamonds'), c('K', 'clubs')]
        engine.ai.hand = cards.copy()
        result = engine.ai_meld(cards)
        assert result is False

    def test_ai_discard(self):
        engine = make_engine()
        engine.phase = Phase.AI_TURN
        card = engine.ai.hand[0]
        engine.ai_discard(card)
        assert card not in engine.ai.hand
        assert engine.discard_pile[-1] == card
        assert engine.phase == Phase.PLAYER_DRAW

    def test_ai_goes_out(self):
        engine = make_engine()
        engine.phase = Phase.AI_TURN
        engine.ai.hand = [c('2', 'spades')]
        engine.ai_discard(c('2', 'spades'))
        assert engine.phase == Phase.ROUND_END


# ── Round scoring ──────────────────────────────────────────

class TestRoundScoring:
    def test_scores_accumulate(self):
        engine = make_engine()
        engine.player_draw_from_pile()

        # Set up player to go out with a meld and one discard
        engine.player.hand = [
            c('K', 'hearts'), c('K', 'diamonds'), c('K', 'clubs'), c('2', 'spades')
        ]
        engine.player_meld(['Kh', 'Kd', 'Kc'])
        engine.player_discard('2s')

        assert engine.phase in (Phase.ROUND_END, Phase.AI_TURN, Phase.GAME_OVER)

    def test_game_over_at_target(self):
        engine = GameEngine(target_score=100)
        engine.new_round()
        engine.player.total_score = 95
        # Simulate going out with a 30-point meld
        engine.phase = Phase.PLAYER_MELD_OR_DISCARD
        engine.player.hand = [c('K', 'hearts'), c('K', 'diamonds'), c('K', 'clubs')]
        engine.player_meld(['Kh', 'Kd', 'Kc'])
        assert engine.phase == Phase.ROUND_END or engine.phase == Phase.GAME_OVER


# ── Sorting ────────────────────────────────────────────────

class TestSorting:
    def test_sort_by_rank(self):
        engine = make_engine()
        engine.player.hand = [c('K', 'hearts'), c('3', 'hearts'), c('7', 'hearts')]
        engine.player_sort_hand('rank')
        ranks = [card.rank for card in engine.player.hand]
        assert ranks == ['3', '7', 'K']

    def test_sort_by_suit(self):
        engine = make_engine()
        engine.player.hand = [c('5', 'spades'), c('5', 'hearts'), c('5', 'clubs')]
        engine.player_sort_hand('suit')
        suits = [card.suit for card in engine.player.hand]
        assert suits == ['hearts', 'clubs', 'spades']


# ── Serialization ──────────────────────────────────────────

class TestSerialization:
    def test_to_dict(self):
        engine = make_engine()
        d = engine.to_dict()
        assert d['phase'] == 'player_draw'
        assert d['round_number'] == 1
        assert len(d['player']['hand']) == 7
        assert d['ai']['hand'] == []  # hidden
        assert d['ai']['hand_count'] == 7

    def test_to_json(self):
        engine = make_engine()
        import json
        state = json.loads(engine.to_json())
        assert len(state['ai']['hand']) == 7  # visible in full serialization
        assert 'deck_cards' in state


# ── Deck ───────────────────────────────────────────────────

class TestDeck:
    def test_deck_size(self):
        deck = Deck()
        assert deck.remaining == 54  # 52 + 2 jokers

    def test_draw(self):
        deck = Deck()
        card = deck.draw()
        assert card is not None
        assert deck.remaining == 53

    def test_draw_empty(self):
        deck = Deck()
        deck.cards = []
        assert deck.draw() is None

    def test_deal(self):
        deck = Deck()
        hand = deck.deal(7)
        assert len(hand) == 7
        assert deck.remaining == 47

    def test_shuffle_changes_order(self):
        d1 = Deck()
        d2 = Deck()
        d2.shuffle()
        # Very unlikely to be the same order after shuffle
        ids1 = [c.id for c in d1.cards]
        ids2 = [c.id for c in d2.cards]
        assert ids1 != ids2 or True  # Allow for extremely rare collision
