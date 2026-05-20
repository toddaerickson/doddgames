"""Tests for rummy5000.game.scoring module."""

from rummy5000.game.deck import Card
from rummy5000.game.scoring import (
    _is_low_ace_run,
    calculate_round_score,
    card_points,
    score_hand,
    score_meld,
    score_melds,
)

# ── Helpers ────────────────────────────────────────────────

def c(rank, suit='hearts'):
    return Card(rank=rank, suit=suit)

def joker(color='red'):
    return Card(rank='Joker', suit=color, is_joker=True)


# ── card_points ────────────────────────────────────────────

class TestCardPoints:
    def test_joker(self):
        assert card_points(joker()) == 50

    def test_ace_high(self):
        assert card_points(c('A')) == 15

    def test_ace_low(self):
        assert card_points(c('A'), in_low_run=True) == 5

    def test_face_cards(self):
        assert card_points(c('K')) == 10
        assert card_points(c('Q')) == 10
        assert card_points(c('J')) == 10

    def test_number_cards(self):
        assert card_points(c('2')) == 2
        assert card_points(c('5')) == 5
        assert card_points(c('10')) == 10


# ── _is_low_ace_run ───────────────────────────────────────

class TestIsLowAceRun:
    def test_a_2_3_is_low(self):
        assert _is_low_ace_run([c('A'), c('2'), c('3')]) is True

    def test_a_2_3_4_is_low(self):
        assert _is_low_ace_run([c('A'), c('2'), c('3'), c('4')]) is True

    def test_q_k_a_is_high(self):
        assert _is_low_ace_run([c('Q'), c('K'), c('A')]) is False

    def test_no_ace(self):
        assert _is_low_ace_run([c('3'), c('4'), c('5')]) is False

    def test_ace_with_joker_and_2(self):
        assert _is_low_ace_run([c('A'), c('2'), joker()]) is True

    def test_all_jokers(self):
        assert _is_low_ace_run([joker(), joker('black'), joker()]) is False


# ── score_meld ─────────────────────────────────────────────

class TestScoreMeld:
    def test_low_ace_run(self):
        # A(5) + 2 + 3 = 10
        assert score_meld([c('A'), c('2'), c('3')]) == 10

    def test_high_ace_set(self):
        # A(15) * 3 = 45
        meld = [c('A', 'hearts'), c('A', 'diamonds'), c('A', 'clubs')]
        assert score_meld(meld) == 45

    def test_face_set(self):
        # K(10) * 3 = 30
        meld = [c('K', 'hearts'), c('K', 'diamonds'), c('K', 'clubs')]
        assert score_meld(meld) == 30

    def test_number_run(self):
        # 5 + 6 + 7 = 18
        assert score_meld([c('5'), c('6'), c('7')]) == 18

    def test_meld_with_joker(self):
        # 5 + joker(50) + 7 = 62
        assert score_meld([c('5'), joker(), c('7')]) == 62

    def test_high_ace_run(self):
        # Q(10) + K(10) + A(15) = 35
        assert score_meld([c('Q'), c('K'), c('A')]) == 35


# ── score_melds ────────────────────────────────────────────

class TestScoreMelds:
    def test_multiple_melds(self):
        m1 = [c('5'), c('6'), c('7')]   # 18
        m2 = [c('K', 'hearts'), c('K', 'diamonds'), c('K', 'clubs')]  # 30
        assert score_melds([m1, m2]) == 48

    def test_empty(self):
        assert score_melds([]) == 0


# ── score_hand ─────────────────────────────────────────────

class TestScoreHand:
    def test_mixed_hand(self):
        hand = [c('A'), c('5'), joker()]
        # 15 + 5 + 50 = 70
        assert score_hand(hand) == 70

    def test_empty_hand(self):
        assert score_hand([]) == 0


# ── calculate_round_score ──────────────────────────────────

class TestCalculateRoundScore:
    def test_positive_net(self):
        melds = [[c('K', 'hearts'), c('K', 'diamonds'), c('K', 'clubs')]]  # 30
        hand = [c('2')]  # penalty 2
        result = calculate_round_score(melds, hand)
        assert result['meld_points'] == 30
        assert result['hand_penalty'] == 2
        assert result['net'] == 28

    def test_negative_net(self):
        melds = [[c('2', 'hearts'), c('3', 'hearts'), c('4', 'hearts')]]  # 9
        hand = [c('A'), c('K')]  # 15 + 10 = 25
        result = calculate_round_score(melds, hand)
        assert result['net'] == -16

    def test_went_out_no_penalty(self):
        melds = [[c('5'), c('6'), c('7')]]  # 18
        hand = []
        result = calculate_round_score(melds, hand)
        assert result['hand_penalty'] == 0
        assert result['net'] == 18
