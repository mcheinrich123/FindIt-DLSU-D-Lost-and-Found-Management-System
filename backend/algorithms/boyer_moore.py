"""4. Boyer-Moore string search ..... BoyerMoore, contains(), hit_ranges()

   Finds where a pattern occurs in a text without checking every position. Every search box
   sends its query to the server (/api/search in app.py), which looks for it in each record's
   text with this. The pattern is lined up under the text and compared from its LAST letter
   backwards; on a mismatch it jumps ahead by the larger of two shifts, both worked out from
   the pattern alone before the search starts:

       bad character  line the text letter that didn't match up with the last place it appears
                      in the pattern, or move the pattern past it if it isn't in it
       good suffix    line the letters that did match up with the next place they appear in
                      the pattern, or with the longest start of the pattern that they end with

   Searching "lost black wallet" for "wallet" tries 3 positions instead of 12 and looks at 7 of
   its 17 letters. The tables depend only on the pattern, so each query's are built once and
   reused for every record it is compared with.
"""

from functools import lru_cache

class BoyerMoore:
    """A pattern to search for, with its two shift tables built once (see the top of this file)."""

    def __init__(self, pattern):
        self.pattern = pattern
        self.last = {letter: i for i, letter in enumerate(pattern)}  # bad character: each letter's last index
        self.shift = self._good_suffix(pattern)

    @staticmethod
    def _good_suffix(pattern):
        """The good suffix table (the strong rule). shift[j + 1] is how far to move the pattern
        when the letter at j didn't match but pattern[j + 1:] did; shift[0] is the move after a
        full match. border[i] is where the widest border of pattern[i:] starts (a border is a
        part that is both a prefix and a suffix of it)."""
        m = len(pattern)
        shift = [0] * (m + 1)
        border = [0] * (m + 1)

        # Case 1: the matched suffix appears again in the pattern, after a different letter.
        i, j = m, m + 1
        border[i] = j
        while i > 0:
            while j <= m and pattern[i - 1] != pattern[j - 1]:
                if shift[j] == 0:
                    shift[j] = j - i
                j = border[j]
            i -= 1
            j -= 1
            border[i] = j

        # Case 2: only the end of the matched suffix appears, as the start of the pattern.
        j = border[0]
        for i in range(m + 1):
            if shift[i] == 0:
                shift[i] = j
            if i == j:
                j = border[j]
        return shift

    def find(self, text, start=0):
        """The first index at or after `start` (0 or more) where the pattern occurs in `text`,
        or -1, like text.find(pattern, start)."""
        pattern, m = self.pattern, len(self.pattern)
        start = max(start, 0)
        if m == 0:
            return start if start <= len(text) else -1
        s = start                                         # where the pattern starts under the text
        while s <= len(text) - m:
            j = m - 1
            while j >= 0 and pattern[j] == text[s + j]:  # compare right to left
                j -= 1
            if j < 0:
                return s
            s += max(self.shift[j + 1], j - self.last.get(text[s + j], -1))
        return -1

    def find_all(self, text):
        """Every index where the pattern occurs in `text`, without overlaps."""
        m = len(self.pattern)
        found = []
        at = self.find(text) if m else -1
        while at != -1:
            found.append(at)
            at = self.find(text, at + m)
        return found


@lru_cache(maxsize=512)
def _boyer_moore(pattern):
    """A search sends the same query for every record, so each pattern is compiled once."""
    return BoyerMoore(pattern)


def contains(text, pattern):
    """Whether `pattern` occurs in `text` (Boyer-Moore). An empty pattern always does."""
    return _boyer_moore(pattern).find(text) != -1


def hit_ranges(text, patterns):
    """Where the patterns occur in `text`, ignoring case, as sorted [start, end] ranges for the
    page to mark. They count UTF-16 code units, the way the browser does. None if lowercasing
    changes the text's length, since the positions wouldn't line up."""
    text = text or ""
    lower = text.lower()
    if len(lower) != len(text):
        return []
    ranges = sorted((at, at + len(pattern))
                    for pattern in {p.lower() for p in patterns if p}
                    for at in _boyer_moore(pattern).find_all(lower))
    return [[_utf16(text, start), _utf16(text, end)] for start, end in ranges]


def _utf16(text, index):
    """A position in `text` counted in UTF-16 code units: characters beyond U+FFFF count twice."""
    return index + sum(1 for ch in text[:index] if ord(ch) > 0xFFFF)
