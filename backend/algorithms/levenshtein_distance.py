"""3. Levenshtein distance ..... levenshtein(), correct(), brand_matches()

   The fewest one-letter edits (insert, delete or substitute) that turn one word into another:
   "cellfone" -> "cellphone" is 2 (f becomes p, h is added). It is computed with the classic
   dynamic-programming table, where d(i, j) is the distance between the first i letters of a
   and the first j letters of b:

       d(i, 0) = i,   d(0, j) = j
       d(i, j) = min(d(i-1, j) + 1,                              delete a letter
                     d(i, j-1) + 1,                              insert a letter
                     d(i-1, j-1) + (0 if a[i] == b[j] else 1))   substitute one

   NER uses it to read typos (correct()). A word the dictionary doesn't know is read as the
   dictionary word closest to it, if that word:
       - is at most 1 edit away for words of 5 to 7 letters, or 2 for 8 letters or more. Shorter
         words are never corrected: too many real ones are a letter apart ("back" / "black").
       - starts with the same letter (people rarely mistype the first one: "class" isn't "glass")
       - is the only dictionary word that close
   and the word isn't a real word on its own (NOT_TYPOS: "while" isn't "white").

   Claims use it to compare the brand a claimant names with the item's real brand
   (brand_matches()): "Samsng" matches "Samsung Galaxy A52".
"""

from functools import lru_cache

from .textutils import STOPWORDS, _clean, stem, tokenize

# ner.py imports correct() from this file and this file needs NER's dictionary, so `ner` is
# imported inside the functions that use it, after both files have loaded.

def levenshtein(a, b):
    """The fewest one-letter edits (insert, delete or substitute) that turn `a` into `b`.

    Dynamic programming over the table d(i, j) in the module docstring, one row at a time:
    `previous` is row i - 1 and `current` is row i."""
    if len(a) < len(b):
        a, b = b, a                          # rows as long as the shorter word
    previous = list(range(len(b) + 1))       # d(0, j) = j
    for i, letter in enumerate(a, 1):
        current = [i]                        # d(i, 0) = i
        for j, other in enumerate(b, 1):
            current.append(min(previous[j] + 1,                    # delete
                               current[j - 1] + 1,                 # insert
                               previous[j - 1] + (letter != other)))  # substitute (free if equal)
        previous = current
    return previous[-1]


def max_typos(length):
    """How many edits a word of this length may be from the word it's meant to be: none under 5
    letters, where too many real words are a letter apart ("back" / "black"), 1 up to 7 letters,
    2 from 8."""
    return 0 if length < 5 else 1 if length < 8 else 2


@lru_cache(maxsize=None)
def _dictionary_words():
    """The words of the NER dictionary's phrases, by first letter. Built on first use."""
    from .ner import GAZETTEER
    words = {}
    for phrase in GAZETTEER.phrases:
        for word in phrase:
            words.setdefault(word[0], set()).add(word)
    return words


# Real words that are a typo away from a dictionary word, found by running correct() over
# ordinary report text. They are never "corrected": "while" isn't "white", "table" isn't "tablet".
NOT_TYPOS = {stem(word) for word in """
    apply based battle block blown booth casino charged clean clothes couch grass greet
    highlighted kahon marked market mental noted paint phony planned prone shape share shift
    slippery stony table while witch woolen write
""".split()}


@lru_cache(maxsize=20000)
def correct(word):
    """The dictionary word that `word` (folded and stemmed, like a Token's) is a typo of, or None.

    That is the dictionary word with the same first letter that is fewest edits away, if it is
    within max_typos() and no other word is as close. Words the dictionary has, stopwords,
    numbers and NOT_TYPOS are never corrected."""
    candidates = _dictionary_words().get(word[:1], ())
    limit = max_typos(len(word))
    if not limit or word in candidates or word in STOPWORDS or word in NOT_TYPOS or not word.isalpha():
        return None
    best, best_distance, tie = None, limit + 1, False
    for candidate in candidates:
        if abs(len(candidate) - len(word)) > limit:
            continue                         # the length difference alone is too many edits
        distance = levenshtein(word, candidate)
        if distance < best_distance:
            best, best_distance, tie = candidate, distance, False
        elif distance == best_distance:
            tie = True
    return None if tie else best


def typo_fixes(*texts):
    """The typos NER read as dictionary words in `texts`, each once, in order of appearance:
    [{written: "walet", word: "wallet", edits: 1}]."""
    from .ner import _analyze
    fixes, seen = [], set()
    for text in texts:
        for e in _analyze(_clean(text))[1]:
            for written, word, edits in e.typos:
                if (written.lower(), word.lower()) not in seen:
                    seen.add((written.lower(), word.lower()))
                    fixes.append({"written": written, "word": word, "edits": edits})
    return fixes


def _brand_words(text):
    """The words of a brand as written, without stopwords and numbers ("iPhone 13" -> iphone)."""
    return [token.word for token in tokenize(_clean(text))
            if token.word not in STOPWORDS and not token.word.isdigit()]


def brand_matches(actual, claimed):
    """Whether the brand a claimant names (`claimed`) is the item's real brand (`actual`).

    A word of the real brand matches a word the claimant wrote when it is within max_typos() of
    its length (Levenshtein). The brands match when:
        - the whole names do, spaces and punctuation aside   "Samsng" / "Samsung", "rayban" / "Ray-Ban"
        - every word of one is in the other                  "Samsung" / "Samsung Galaxy A52"
        - the brand dictionary reads both as one brand       "iPhone" / "Apple"
    """
    real, said = _brand_words(actual), _brand_words(claimed)
    if not real or not said:
        return False

    def same(real_word, said_word):
        return levenshtein(real_word, said_word) <= max_typos(len(real_word))

    if same("".join(real), "".join(said)):
        return True
    if (all(any(same(r, s) for r in real) for s in said)
            or all(any(same(r, s) for s in said) for r in real)):
        return True
    from .ner import entity_summary
    return bool(set(entity_summary(actual)["BRAND"]) & set(entity_summary(claimed)["BRAND"]))
