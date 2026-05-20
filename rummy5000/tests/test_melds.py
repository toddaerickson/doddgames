"""Tests for rummy5000.game.melds module."""

from rummy5000.game.deck import Card
from rummy5000.game.melds import (
    can_lay_off,
    find_all_possible_melds,
    find_layoff_options,
    is_valid_meld,
    is_valid_run,
    is_valid_set,
)

# ── Helpers ────────────────────────────────────────────────

def c(rank, suit='hearts'):
    return Card(rank=rank, suit=suit)

def joker(color='red'):
    return Card(rank='Joker', suit=color, is_joker=True)


# ── is_valid_set ───────────────────────────────────────────

class TestIsValidSet:
    def test_three_of_kind(self):
        assert is_valid_set([c('K', 'hearts'), c('K', 'diamonds'), c('K', 'clubs')])

    def test_four_of_kind(self):
        assert is_valid_set([c('7', 'hearts'), c('7', 'diamonds'), c('7', 'clubs'), c('7', 'spades')])

    def test_too_few(self):
        assert not is_valid_set([c('K', 'hearts'), c('K', 'diamonds')])

    def test_too_many(self):
        cards = [c('K', s) for s in ('hearts', 'diamonds', 'clubs', 'spades')]
        cards.append(joker())
        assert not is_valid_set(cards)

    def test_different_ranks(self):
        assert not is_valid_set([c('K', 'hearts'), c('Q', 'diamonds'), c('J', 'clubs')])

    def test_duplicate_suits(self):
        assert not is_valid_set([c('K', 'hearts'), c('K', 'hearts'), c('K', 'clubs')])

    def test_with_joker(self):
        assert is_valid_set([c('K', 'hearts'), c('K', 'diamonds'), joker()])

    def test_too_many_jokers(self):
        # 2 jokers + 1 natural = jokers outnumber naturals
        assert not is_valid_set([c('K', 'hearts'), joker('red'), joker('black')])

    def test_all_jokers(self):
        assert not is_valid_set([joker('red'), joker('black'), joker('red')])


# ── is_valid_run ───────────────────────────────────────────

class TestIsValidRun:
    def test_basic_run(self):
        assert is_valid_run([c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')])

    def test_long_run(self):
        cards = [c(r, 'spades') for r in ('5', '6', '7', '8', '9')]
        assert is_valid_run(cards)

    def test_ace_low(self):
        assert is_valid_run([c('A', 'hearts'), c('2', 'hearts'), c('3', 'hearts')])

    def test_ace_high(self):
        assert is_valid_run([c('Q', 'hearts'), c('K', 'hearts'), c('A', 'hearts')])

    def test_mixed_suits(self):
        assert not is_valid_run([c('3', 'hearts'), c('4', 'diamonds'), c('5', 'hearts')])

    def test_non_consecutive(self):
        assert not is_valid_run([c('3', 'hearts'), c('5', 'hearts'), c('7', 'hearts')])

    def test_too_few(self):
        assert not is_valid_run([c('3', 'hearts'), c('4', 'hearts')])

    def test_with_joker_filling_gap(self):
        # 3, joker(fills 4), 5
        assert is_valid_run([c('3', 'hearts'), joker(), c('5', 'hearts')])

    def test_duplicate_ranks(self):
        assert not is_valid_run([c('5', 'hearts'), c('5', 'hearts'), c('6', 'hearts')])

    def test_all_jokers(self):
        assert not is_valid_run([joker('red'), joker('black'), joker('red')])

    def test_wrap_around_not_allowed(self):
        # K-A-2 wrapping is not valid
        assert not is_valid_run([c('K', 'hearts'), c('A', 'hearts'), c('2', 'hearts')])


# ── is_valid_meld ──────────────────────────────────────────

class TestIsValidMeld:
    def test_valid_set(self):
        assert is_valid_meld([c('9', 'hearts'), c('9', 'diamonds'), c('9', 'clubs')])

    def test_valid_run(self):
        assert is_valid_meld([c('J', 'hearts'), c('Q', 'hearts'), c('K', 'hearts')])

    def test_invalid(self):
        assert not is_valid_meld([c('3', 'hearts'), c('7', 'diamonds'), c('K', 'clubs')])


# ── can_lay_off ────────────────────────────────────────────

class TestCanLayOff:
    def test_extend_run(self):
        meld = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
        assert can_lay_off(c('6', 'hearts'), meld)
        assert can_lay_off(c('2', 'hearts'), meld)

    def test_extend_set(self):
        meld = [c('K', 'hearts'), c('K', 'diamonds'), c('K', 'clubs')]
        assert can_lay_off(c('K', 'spades'), meld)

    def test_cannot_extend_set_beyond_4(self):
        meld = [c('K', 'hearts'), c('K', 'diamonds'), c('K', 'clubs'), c('K', 'spades')]
        assert not can_lay_off(joker(), meld)

    def test_wrong_card(self):
        meld = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
        assert not can_lay_off(c('8', 'hearts'), meld)

    def test_joker_cannot_layoff_on_run(self):
        # Jokers can't be laid off — ambiguous position in a run
        meld = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
        assert not can_lay_off(joker(), meld)


# ── find_all_possible_melds ────────────────────────────────

class TestFindAllPossibleMelds:
    def test_finds_set(self):
        hand = [c('K', 'hearts'), c('K', 'diamonds'), c('K', 'clubs'), c('2', 'spades')]
        melds = find_all_possible_melds(hand)
        assert len(melds) >= 1
        assert any(len(m) == 3 and all(card.rank == 'K' for card in m if not card.is_joker) for m in melds)

    def test_finds_run(self):
        hand = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts'), c('9', 'spades')]
        melds = find_all_possible_melds(hand)
        assert len(melds) >= 1

    def test_no_melds(self):
        hand = [c('2', 'hearts'), c('7', 'diamonds'), c('K', 'clubs')]
        melds = find_all_possible_melds(hand)
        assert len(melds) == 0

    def test_finds_melds_with_joker(self):
        hand = [c('5', 'hearts'), c('7', 'hearts'), joker()]
        melds = find_all_possible_melds(hand)
        assert len(melds) >= 1


# ── find_layoff_options ────────────────────────────────────

class TestFindLayoffOptions:
    def test_finds_layoff(self):
        hand = [c('6', 'hearts'), c('9', 'spades')]
        table = [[c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]]
        options = find_layoff_options(hand, table)
        assert any(card.rank == '6' for card, _ in options)

    def test_no_layoffs(self):
        hand = [c('9', 'spades')]
        table = [[c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]]
        options = find_layoff_options(hand, table)
        assert len(options) == 0
