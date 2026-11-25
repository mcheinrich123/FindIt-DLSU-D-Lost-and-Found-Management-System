"""FindIt NLP: the text algorithms behind SWAFO's lost-and-found matching and search.

Plain Python (standard library only), so the project needs nothing beyond Flask.

Each algorithm has its own file in this folder:

    textutils.py ............ shared: splitting text into words, stemming, stopwords
    ner.py .................. 1. Named entity recognition (NER)
    tfidf.py ................ 2. TF-IDF with cosine similarity (Matcher)
    levenshtein_distance.py . 3. Levenshtein distance (typo tolerance, brand matching)
    boyer_moore.py .......... 4. Boyer-Moore string search

The app imports this folder as one package (`import algorithms` in app.py), so every function
below is reachable as algorithms.<name>, whichever file it lives in.
"""

from .textutils import Token, tokenize, stem, STOPWORDS
from .ner import (Entity, ITEMS, BRANDS, COLORS, MATERIALS, LOCATIONS, PLACES, OTHER, LABELS,
                  GAZETTEER, extract_entities, entity_summary, place_of, place_score, place_label)
from .tfidf import Matcher, TfidfIndex, cosine, date_score, report_terms
from .levenshtein_distance import levenshtein, max_typos, correct, typo_fixes, brand_matches
from .boyer_moore import BoyerMoore, contains, hit_ranges
