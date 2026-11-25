"""Shared text helpers every algorithm uses: normalizing text, splitting it into words,
stemming, and the stopwords too common to tell reports apart."""

import re
import unicodedata
from collections import namedtuple

Token = namedtuple("Token", "word start end")  # word: folded and stemmed; start/end: position in the text

_WORD = re.compile(r"[^\W_]+(?:['’][^\W_]+)*")    # letters and digits, keeping "Mila's" together
_PIECE = re.compile(r"[^\W\d_]+|\d+")              # "iphone13" -> "iphone", "13"


def _fold(text):
    """Lowercase, without accents or apostrophes: "Doña" -> "dona", "Mila's" -> "milas"."""
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return text.lower().replace("'", "").replace("’", "")


def stem(word):
    """A light stemmer that drops a plural "s" ("keys" -> "key"). The text and the dictionaries
    both go through it, so they always agree."""
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _clean(text):
    return unicodedata.normalize("NFC", str(text or ""))


def tokenize(text):
    """The words of `text` as Tokens. `text` must already be NFC (see _clean)."""
    tokens = []
    for match in _WORD.finditer(text):
        for piece in _PIECE.findall(_fold(match.group())):
            tokens.append(Token(stem(piece), match.start(), match.end()))
    return tokens


# Words too common to tell reports apart (English and Filipino), compared after stemming.
STOPWORDS = {stem(word) for word in """
    a an the and or but of in on at to for with without from by near inside beside behind around
    under over into onto off up down is was were are be been being it its this that these those
    i me my mine we our you your he she his her they their them has have had do did not no yes
    very really just also some any one two color colour lost found item thing left forgot forgotten
    maybe probably please po ang ng sa na ay ko ako yung iyong nung noong may mga si ni kay
    naiwan nawala nakita malapit loob dito doon kasi pero lang
""".split()}
