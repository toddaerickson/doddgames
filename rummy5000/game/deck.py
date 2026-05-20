"""Card and Deck models for Rummy 5000."""

import random
from dataclasses import dataclass

SUITS = ('hearts', 'diamonds', 'clubs', 'spades')
RANKS = ('A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K')
RANK_ORDER = {r: i for i, r in enumerate(RANKS)}


@dataclass
class Card:
    rank: str
    suit: str
    is_joker: bool = False

    @property
    def id(self) -> str:
        if self.is_joker:
            return f"joker_{self.suit}"
        return f"{self.rank}{self.suit[0]}"

    @property
    def rank_index(self) -> int:
        if self.is_joker:
            return -1
        return RANK_ORDER[self.rank]

    @property
    def point_value(self) -> int:
        """Default point value. Ace context (high/low) resolved by scoring module."""
        if self.is_joker:
            return 50
        if self.rank == 'A':
            return 15  # default high; scoring adjusts to 5 for low runs
        if self.rank in ('J', 'Q', 'K'):
            return 10
        return int(self.rank)

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'rank': self.rank,
            'suit': self.suit,
            'is_joker': self.is_joker,
            'point_value': self.point_value,
        }

    def __eq__(self, other):
        if not isinstance(other, Card):
            return False
        return self.id == other.id

    def __hash__(self):
        return hash(self.id)

    def __repr__(self):
        if self.is_joker:
            return f"Joker({self.suit})"
        suit_symbols = {'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠'}
        return f"{self.rank}{suit_symbols.get(self.suit, '?')}"


class Deck:
    """Standard 52-card deck plus 2 jokers."""

    def __init__(self):
        self.cards: list[Card] = []
        self.reset()

    def reset(self):
        self.cards = []
        for suit in SUITS:
            for rank in RANKS:
                self.cards.append(Card(rank=rank, suit=suit))
        # Two jokers distinguished by color
        self.cards.append(Card(rank='Joker', suit='red', is_joker=True))
        self.cards.append(Card(rank='Joker', suit='black', is_joker=True))

    def shuffle(self):
        random.shuffle(self.cards)

    def draw(self) -> Card | None:
        if not self.cards:
            return None
        return self.cards.pop()

    def deal(self, num_cards: int) -> list[Card]:
        hand = []
        for _ in range(num_cards):
            card = self.draw()
            if card is None:
                break
            hand.append(card)
        return hand

    @property
    def remaining(self) -> int:
        return len(self.cards)

    def to_dict(self) -> dict:
        return {'remaining': self.remaining}
