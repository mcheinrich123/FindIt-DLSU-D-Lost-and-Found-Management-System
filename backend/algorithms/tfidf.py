"""2. TF-IDF with cosine similarity ..... Matcher

   Compares lost reports with found items. Each report becomes a bag of terms: the words of its
   name (counted twice), color, description, brand and unique details, minus stopwords, plus the
   canonical entities NER found in them ("item:phone", "color:blue"). So "Smartphone with blue
   case" and "lost my blue cellphone" share item:phone and color:blue even though they share
   almost no words.

       tf(t, d)  = 1 + ln(count of t in d)                (sublinear term frequency)
       idf(t)    = ln((1 + N) / (1 + df(t))) + 1          (smoothed; N = number of reports)
       w(t, d)   = tf(t, d) * idf(t), then each vector is scaled to length 1
       cosine(a, b) = sum of w(t, a) * w(t, b) over the terms they share   (0 to 1)

   Rare, specific terms ("aquaflask", "cat sticker") weigh more than common ones ("black").
   The final match score mixes that text similarity with three structured signals:

       score = 100 * (0.60 * text + 0.15 * location + 0.15 * category + 0.10 * date)

       location  1 same place, 0.5 same campus, 0 otherwise (NER reads "Other / Not sure" text)
       category  1 same category, 0 otherwise
       date      1 if found within 7 days after the loss, falling to 0 at 60 days;
                 0 if it was found before it was lost
"""

import math
from collections import Counter

from .textutils import STOPWORDS, _clean
from .ner import _analyze, place_of, place_score

# How much each field counts. The name says the most about what the item is.
FIELD_WEIGHTS = (("name", 2), ("color", 1), ("description", 1), ("brand", 1), ("identifying_details", 1))

# An entity is a cleaner signal than any single word, so its canonical form counts double.
ENTITY_WEIGHT = 2

# score = 100 * sum(weight * signal)
SCORE_WEIGHTS = {"text": 0.60, "location": 0.15, "category": 0.15, "date": 0.10}
MIN_TEXT = 0.10   # below this, the two reports share nothing worth showing
MIN_SCORE = 40    # weaker matches aren't suggested to SWAFO (students get a stricter floor, app.py)
CLOSED_STATUSES = ("claimed", "disposed")  # returned to the owner, or disposed of after the holding period


def report_terms(record, fix_typos=True):
    """The terms TF-IDF counts for one report, with their (weighted) counts. Place names are left
    out: the location signal scores them separately."""
    terms = Counter()
    for field, weight in FIELD_WEIGHTS:
        text = _clean(record.get(field))
        if not text:
            continue
        tokens, entities = _analyze(text, fix_typos)
        in_place = {index for e in entities if e.label == "LOCATION" for index in range(e.first, e.last)}
        for index, token in enumerate(tokens):
            if index in in_place or token.word in STOPWORDS or len(token.word) < 2:
                continue
            terms[token.word] += weight
        for e in entities:
            if e.label == "LOCATION":
                continue
            terms[f"{e.label.lower()}:{e.value}"] += ENTITY_WEIGHT * weight
            if e.implies:
                terms[f"item:{e.implies}"] += ENTITY_WEIGHT * weight
    return terms


class TfidfIndex:
    """TF-IDF vectors for a set of documents, each scaled to length 1."""

    def __init__(self, documents):
        """documents: {key: Counter of terms}"""
        total = len(documents)
        document_frequency = Counter(term for terms in documents.values() for term in terms)
        self.idf = {term: math.log((1 + total) / (1 + df)) + 1 for term, df in document_frequency.items()}
        self.vectors = {key: self._vector(terms) for key, terms in documents.items()}

    def _vector(self, terms):
        weights = {term: (1 + math.log(count)) * self.idf[term] for term, count in terms.items() if count > 0}
        length = math.sqrt(sum(w * w for w in weights.values())) or 1.0
        return {term: w / length for term, w in weights.items()}


def cosine(a, b):
    """Cosine similarity of two unit-length sparse vectors: their dot product, 0 to 1."""
    if len(a) > len(b):
        a, b = b, a
    return sum(weight * b.get(term, 0.0) for term, weight in a.items())


def date_score(lost_on, found_on):
    """1 if found within a week after the loss, falling to 0 at 60 days; 0 if found before it was
    lost (a day's slack allows for a wrong date)."""
    if not lost_on or not found_on:
        return 0.0
    days = (found_on - lost_on).days
    if days < -1:
        return 0.0
    if days <= 7:
        return 1.0
    if days >= 60:
        return 0.0
    return 1 - (days - 7) / 53


class Matcher:
    """Scores lost reports against found items (and the reverse) with TF-IDF cosine similarity
    plus the location, category and date signals.

    records: dicts with id, type ("lost" / "found"), status, name, category, color, description,
    brand, identifying_details, location, location_other, location_details and event_date (a date).
    Build one per request; the IDF is computed over all the records given. fix_typos=False reads
    every report exactly as written, without Levenshtein, to show what the typo fixes add.
    """

    def __init__(self, records, fix_typos=True):
        self.records = {record["id"]: record for record in records}
        self.index = TfidfIndex({record["id"]: report_terms(record, fix_typos) for record in records})
        self.places = {record["id"]: place_of(record, fix_typos) for record in records}

    def compare(self, a_id, b_id):
        """The match score of two reports, with each signal (0 to 1) behind it."""
        a, b = self.records[a_id], self.records[b_id]
        lost, found = (a, b) if a["type"] == "lost" else (b, a)
        signals = {
            "text": cosine(self.index.vectors[a_id], self.index.vectors[b_id]),
            "location": place_score(self.places[a_id], self.places[b_id]),
            "category": 1.0 if a["category"] == b["category"] else 0.0,
            "date": date_score(lost.get("event_date"), found.get("event_date")),
        }
        score = 100 * sum(SCORE_WEIGHTS[name] * value for name, value in signals.items())
        days_apart = ((found["event_date"] - lost["event_date"]).days
                      if lost.get("event_date") and found.get("event_date") else None)
        return {
            "id": b_id,
            "score": round(score),
            "signals": {name: round(value, 3) for name, value in signals.items()},
            "daysApart": days_apart,
        }

    def matches(self, record_id, limit=10, *, exclude_ids=(), min_score=MIN_SCORE):
        """The best matches for one report among the open reports of the other type, best first.
        min_score is the floor a match must reach (MIN_SCORE unless the caller asks for more)."""
        record = self.records[record_id]
        other_type = "found" if record["type"] == "lost" else "lost"
        results = []
        for other_id, other in self.records.items():
            if other_id in exclude_ids or other["type"] != other_type or other.get("status") in CLOSED_STATUSES:
                continue
            result = self.compare(record_id, other_id)
            if result["signals"]["text"] >= MIN_TEXT and result["score"] >= min_score:
                results.append(result)
        results.sort(key=lambda r: (r["score"], r["signals"]["text"]), reverse=True)
        return results[:limit]

    def best(self, record_id, *, exclude_ids=(), min_score=MIN_SCORE):
        """The single best match for a report, or None."""
        found = self.matches(record_id, limit=1, exclude_ids=exclude_ids, min_score=min_score)
        return found[0] if found else None
