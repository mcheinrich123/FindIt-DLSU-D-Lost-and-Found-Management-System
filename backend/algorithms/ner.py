"""1. Named entity recognition (NER) ..... extract_entities(), entity_summary(), place_of()

   Finds what a report talks about and labels it:
       ITEM      "cellphone", "tumbler", "PE uniform"     -> phone, bottle, clothing
       BRAND     "iPhone", "Aquaflask", "G-Shock"         -> Apple, Aquaflask, Casio
       COLOR     "navy blue", "itim"                      -> blue, black
       MATERIAL  "leather", "stainless steel"             -> leather, steel
       LOCATION  "near the CBAA building", "old library"  -> a campus location id

   It is a gazetteer (dictionary-based) NER: every label has a list of known phrases, each tied
   to one canonical value, so synonyms and Filipino words land on the same value. The text is
   split into words, and at each word the longest known phrase wins, so "navy blue" beats "blue"
   and "old library" beats "library". The campus places come from static/js/data/locations.js,
   the same list the pages use, so the two never disagree.

   Typos still count: a word the dictionary doesn't know is read as the dictionary word it is a
   typo of, by Levenshtein distance (levenshtein_distance.py). So "cellfone" is a phone and "aquaflsk" an
   Aquaflask, and TF-IDF counts them with their dictionary spelling.
"""

import json
import os
import re
from collections import namedtuple

from .textutils import _PIECE, _clean, _fold, stem, tokenize
from .levenshtein_distance import correct, levenshtein

Entity = namedtuple("Entity", "label value text start end first last implies typos")
# value: the canonical value (a location's ids for LOCATION); text: the words as written;
# first/last: token positions [first, last); implies: the ITEM a brand or model implies, or None;
# typos: (as written, dictionary word, edits) for each of its words that was a typo (levenshtein_distance.py)

# ITEM: canonical kind -> the ways people write it (English and Filipino)
ITEMS = {
    "phone": ["phone", "cellphone", "cell phone", "smartphone", "smart phone", "mobile", "mobile phone", "cp", "selpon"],
    "phone case": ["phone case", "cellphone case", "phone cover"],
    "earbuds": ["earbuds", "earbud", "earphones", "earphone", "headphones", "headphone", "headset", "airpods case", "earbuds case"],
    "bottle": ["bottle", "water bottle", "tumbler", "flask", "jug", "thermos", "lalagyan ng tubig"],
    "bag": ["bag", "backpack", "knapsack", "sling bag", "tote", "tote bag", "pouch", "handbag", "shoulder bag", "bag pack", "drawstring bag"],
    "wallet": ["wallet", "purse", "coin purse", "card holder", "cardholder", "pitaka"],
    "laptop": ["laptop", "notebook computer", "netbook", "chromebook"],
    "charger": ["charger", "charging cable", "cable", "adapter", "power adapter", "usb cable", "cord"],
    "power bank": ["power bank", "powerbank"],
    "tablet": ["tablet"],
    "watch": ["watch", "smartwatch", "smart watch", "wristwatch", "relo"],
    "calculator": ["calculator", "scientific calculator"],
    "glasses": ["glasses", "eyeglasses", "eye glasses", "sunglasses", "shades", "spectacles", "salamin"],
    "keys": ["key", "keys", "keychain", "key chain", "car key", "car keys", "key fob", "fob", "susi"],
    "id": ["id", "school id", "student id", "id card", "lanyard", "license", "drivers license", "driver license", "atm card", "card"],
    "umbrella": ["umbrella", "payong"],
    "clothing": ["jacket", "hoodie", "shirt", "t shirt", "tshirt", "polo", "uniform", "pe uniform", "sweater", "jersey",
                 "cap", "hat", "pants", "shorts", "skirt", "blazer", "vest", "damit"],
    "footwear": ["shoe", "shoes", "sneakers", "rubber shoes", "slippers", "tsinelas", "sandals", "boots"],
    "book": ["book", "textbook", "notebook", "notes", "planner", "journal", "binder", "folder", "kwaderno"],
    "fan": ["fan", "electric fan", "handheld fan", "mini fan", "portable fan", "pamaypay"],
    "stationery": ["pen", "ballpen", "pencil", "pencil case", "marker", "highlighter", "ruler"],
    "lunchbox": ["lunchbox", "lunch box", "food container", "baunan"],
    "jewelry": ["ring", "necklace", "bracelet", "earrings", "earring", "rosary", "pendant"],
    "usb drive": ["usb", "flash drive", "flashdrive", "usb drive", "thumb drive"],
    "computer accessory": ["mouse", "keyboard"],
    "camera": ["camera"],
    "speaker": ["speaker", "bluetooth speaker"],
}

# BRAND: (canonical brand, the item it implies or None, phrases). A brand with one kind of
# product implies it: "iPhone" is a phone, "Aquaflask" a bottle. Brands are SWAFO-only details,
# so entities from them are only ever sent to admins.
BRANDS = [
    ("Apple", None, ["apple"]),
    ("Apple", "phone", ["iphone"]),
    ("Apple", "tablet", ["ipad"]),
    ("Apple", "laptop", ["macbook"]),
    ("Apple", "earbuds", ["airpods", "airpod"]),
    ("Apple", "watch", ["apple watch"]),
    ("Samsung", None, ["samsung"]),
    ("Samsung", "phone", ["galaxy"]),
    ("Samsung", "earbuds", ["galaxy buds"]),
    ("Samsung", "tablet", ["galaxy tab"]),
    ("Oppo", "phone", ["oppo"]),
    ("Vivo", "phone", ["vivo"]),
    ("Realme", "phone", ["realme"]),
    ("Xiaomi", None, ["xiaomi"]),
    ("Xiaomi", "phone", ["redmi", "poco"]),
    ("Huawei", None, ["huawei"]),
    ("Infinix", "phone", ["infinix"]),
    ("Tecno", "phone", ["tecno"]),
    ("Google", "phone", ["pixel"]),
    ("Nokia", "phone", ["nokia"]),
    ("JBL", None, ["jbl"]),
    ("Sony", None, ["sony"]),
    ("Beats", "earbuds", ["beats"]),
    ("Soundcore", "earbuds", ["soundcore"]),
    ("Aquaflask", "bottle", ["aquaflask", "aqua flask"]),
    ("Hydro Flask", "bottle", ["hydroflask", "hydro flask"]),
    ("Tupperware", None, ["tupperware"]),
    ("JanSport", "bag", ["jansport", "jan sport"]),
    ("Herschel", "bag", ["herschel"]),
    ("The North Face", None, ["north face", "the north face"]),
    ("Samsonite", "bag", ["samsonite"]),
    ("Coach", None, ["coach"]),
    ("Kate Spade", None, ["kate spade"]),
    ("Michael Kors", None, ["michael kors"]),
    ("Lenovo", None, ["lenovo"]),
    ("Lenovo", "laptop", ["thinkpad", "ideapad"]),
    ("Asus", None, ["asus"]),
    ("Acer", None, ["acer"]),
    ("Dell", None, ["dell"]),
    ("HP", None, ["hp"]),
    ("MSI", "laptop", ["msi"]),
    ("Casio", None, ["casio"]),
    ("Casio", "watch", ["g shock", "gshock"]),
    ("Fitbit", "watch", ["fitbit"]),
    ("Garmin", "watch", ["garmin"]),
    ("Seiko", "watch", ["seiko"]),
    ("Ray-Ban", "glasses", ["ray ban", "rayban"]),
    ("Oakley", "glasses", ["oakley"]),
    ("Anker", None, ["anker"]),
    ("Romoss", "power bank", ["romoss"]),
    ("Baseus", None, ["baseus"]),
    ("Logitech", None, ["logitech"]),
    ("Toyota", "keys", ["toyota"]),
    ("Honda", "keys", ["honda"]),
    ("Mitsubishi", "keys", ["mitsubishi"]),
    ("Nissan", "keys", ["nissan"]),
    ("Yamaha", "keys", ["yamaha"]),
    ("Suzuki", "keys", ["suzuki"]),
    ("Nike", None, ["nike"]),
    ("Adidas", None, ["adidas"]),
    ("Uniqlo", "clothing", ["uniqlo"]),
    ("Penshoppe", "clothing", ["penshoppe"]),
]

# COLOR: base color -> shades and names (English and Filipino). Shades fold into their base
# color so "navy" and "blue" still match; the entity keeps the words as written.
COLORS = {
    "black": ["black", "itim", "jet black"],
    "white": ["white", "puti", "off white"],
    "gray": ["gray", "grey", "abo", "abuhin", "charcoal", "dark gray", "light gray"],
    "silver": ["silver"],
    "gold": ["gold", "golden", "rose gold"],
    "red": ["red", "pula", "maroon", "dark red", "crimson", "wine"],
    "pink": ["pink", "rosas", "hot pink", "magenta"],
    "orange": ["orange", "kahel"],
    "yellow": ["yellow", "dilaw", "mustard"],
    "green": ["green", "berde", "dark green", "light green", "olive", "mint"],
    "blue": ["blue", "asul", "navy", "navy blue", "dark blue", "light blue", "sky blue", "royal blue", "teal", "turquoise"],
    "purple": ["purple", "violet", "lavender", "lilac", "lila"],
    "brown": ["brown", "tsokolate", "chocolate", "tan", "khaki"],
    "beige": ["beige", "cream", "nude"],
    "transparent": ["transparent", "clear"],
}

MATERIALS = {
    "leather": ["leather", "faux leather", "leatherette", "katad"],
    "plastic": ["plastic"],
    "metal": ["metal", "metallic"],
    "steel": ["steel", "stainless", "stainless steel"],
    "aluminum": ["aluminum", "aluminium"],
    "rubber": ["rubber"],
    "silicone": ["silicone"],
    "fabric": ["fabric", "cloth", "canvas", "nylon", "polyester", "cotton", "tela"],
    "denim": ["denim", "maong"],
    "wood": ["wood", "wooden", "kahoy"],
    "glass": ["glass"],
}
# This file is in backend/algorithms/; the pages' static/ folder is two folders up.
LOCATIONS_JS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                            "static", "js", "data", "locations.js")


def _load_locations(path=LOCATIONS_JS):
    """The campus places from locations.js: one object per line, like
    { id: "aea-main", name: "...", code: "AEA", campus: "East", aliases: ["library"] },"""
    places = []
    with open(path, encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line.startswith("{ id:"):
                continue
            as_json = re.sub(r'([{,]\s*)([A-Za-z]\w*)\s*:', r'\1"\2":', line.rstrip(","))
            places.append(json.loads(as_json))
    if not places:
        raise RuntimeError(f"No locations found in {path}")
    return places


LOCATIONS = _load_locations()
PLACES = {place["id"]: place for place in LOCATIONS}
OTHER = "other"


def place_label(location, location_other=""):
    """A location as the pages show it, the same as Locations.label() in locations.js:
    "Gregoria De Jesus Hall (GDH)", or for "Other / Not sure" what the reporter typed, if anything."""
    if location == OTHER:
        return (location_other or "").strip() or PLACES[OTHER]["name"]
    place = PLACES.get(location)
    if not place:
        return str(location or "")
    return f"{place['name']} ({place['code']})" if place.get("code") else place["name"]


def _location_names(place):
    """Every way a place is written, with a rank (0 its name, 1 its code, 2 an alias), like
    namesOf() in locations.js: "Balinsasayaw / Command Center Building" gives each half, and
    names lose a final "(Gate 3)" or "Hall" / "Building"."""
    names = [(place["name"], 0)]
    for name in place["name"].split(" / "):
        short = re.sub(r"\s*\(.*\)$", "", name)
        names += [(name, 0), (short, 0), (re.sub(r"\s+(Hall|Building)$", "", short), 0)]
    if place.get("code"):
        names.append((place["code"], 1))
    names += [(alias, 2) for alias in place.get("aliases", [])]
    return names


class Gazetteer:
    """Known phrases (as tuples of stemmed words) -> (label, value, implies)."""

    def __init__(self):
        self.phrases = {}
        self.longest = 1
        self.spellings = {}  # stemmed word -> as the dictionary writes it ("eyeglasse" -> "eyeglasses")

    def spell(self, phrase):
        for piece in _PIECE.findall(_fold(_clean(phrase))):
            self.spellings.setdefault(stem(piece), piece)

    def add(self, label, value, phrases, implies=None):
        for phrase in phrases:
            self.spell(phrase)
            key = tuple(token.word for token in tokenize(_clean(phrase)))
            if not key or key in self.phrases:  # the first label to claim a phrase keeps it
                continue
            self.phrases[key] = (label, value, implies)
            self.longest = max(self.longest, len(key))


def _build_gazetteer():
    gazetteer = Gazetteer()
    # Items first: some words are both a thing and a place's alias ("uniform" is also the
    # Warehouse Building), and in a report the thing is meant. Longer place names still win.
    for kind, phrases in ITEMS.items():
        gazetteer.add("ITEM", kind, phrases)
    for brand, implies, phrases in BRANDS:
        gazetteer.add("BRAND", brand, phrases, implies)

    # A phrase several places share ("dorm", "MAH") names all of them, best rank first.
    owners = {}
    for place in LOCATIONS:
        if not place.get("campus"):
            continue
        for name, rank in _location_names(place):
            gazetteer.spell(name)
            key = tuple(token.word for token in tokenize(_clean(name)))
            if key:
                owners.setdefault(key, {}).setdefault(place["id"], rank)
    for key, ids in owners.items():
        ordered = tuple(sorted(ids, key=lambda place_id: ids[place_id]))
        if key not in gazetteer.phrases:
            gazetteer.phrases[key] = ("LOCATION", ordered, None)
            gazetteer.longest = max(gazetteer.longest, len(key))

    for color, phrases in COLORS.items():
        gazetteer.add("COLOR", color, phrases)
    for material, phrases in MATERIALS.items():
        gazetteer.add("MATERIAL", material, phrases)
    return gazetteer


GAZETTEER = _build_gazetteer()


def _analyze(text, fix_typos=True):
    """(tokens, entities) for already-cleaned text. At each word, the longest known phrase wins.

    Phrases are looked up with typos fixed: each word the dictionary doesn't know is read as the
    dictionary word it is a typo of, if any (correct() in levenshtein_distance.py). The words of a phrase found
    that way take their dictionary spelling in the tokens too, so TF-IDF counts "aquaflsk" as
    "aquaflask". Words outside a phrase keep their own spelling. fix_typos=False reads the text
    exactly as written, to show what the fixes add."""
    tokens = tokenize(text)
    fixed = [(correct(token.word) if fix_typos else None) or token.word for token in tokens]
    entities = []
    i = 0
    while i < len(tokens):
        for size in range(min(GAZETTEER.longest, len(tokens) - i), 0, -1):
            entry = GAZETTEER.phrases.get(tuple(fixed[i:i + size]))
            if entry:
                label, value, implies = entry
                start, end = tokens[i].start, tokens[i + size - 1].end
                typos = tuple((text[token.start:token.end], _spelling(word, text[token.start:token.end]),
                               levenshtein(token.word, word))
                              for token, word in zip(tokens[i:i + size], fixed[i:i + size]) if word != token.word)
                entities.append(Entity(label, value, text[start:end], start, end, i, i + size, implies, typos))
                for k in range(i, i + size):
                    tokens[k] = tokens[k]._replace(word=fixed[k])
                i += size
                break
        else:
            i += 1
    return tokens, entities


def _spelling(word, written):
    """A dictionary word (stemmed) as the dictionary writes it, capitalized like the typo it fixes:
    ("samsung", "Samsng") -> "Samsung"."""
    spelled = GAZETTEER.spellings.get(word, word)
    return spelled.capitalize() if written[:1].isupper() else spelled


def extract_entities(text):
    """The entities in `text`, in order, as dicts: label, value, text (as written), start, end.
    A LOCATION's value is its location id (the best one, if a phrase names several places).
    An entity read through typos lists them: typos [{written, word, edits}]."""
    text = _clean(text)
    return [{
        "label": e.label,
        "value": e.value[0] if e.label == "LOCATION" else e.value,
        "text": e.text,
        "start": e.start,
        "end": e.end,
        **({"implies": e.implies} if e.implies else {}),
        **({"typos": [{"written": w, "word": d, "edits": n} for w, d, n in e.typos]} if e.typos else {}),
    } for e in _analyze(text)[1]]


LABELS = ("ITEM", "BRAND", "COLOR", "MATERIAL", "LOCATION")


def entity_summary(*texts):
    """Each label's distinct values across `texts`, in order of appearance. Brands add the item
    they imply."""
    summary = {label: [] for label in LABELS}
    for text in texts:
        for e in _analyze(_clean(text))[1]:
            values = [e.value[0] if e.label == "LOCATION" else e.value]
            for label, value in [(e.label, values[0])] + ([("ITEM", e.implies)] if e.implies else []):
                if value not in summary[label]:
                    summary[label].append(value)
    return summary


def place_of(record, fix_typos=True):
    """The campus place a report is about: its location id, or, for "Other / Not sure", the first
    place its own words name (location text first, then the description), else "other"."""
    location = record.get("location")
    if PLACES.get(location, {}).get("campus"):
        return location
    for texts in ((record.get("location_other"), record.get("location_details")), (record.get("description"),)):
        text = _clean(" ".join(t for t in texts if t))
        for e in _analyze(text, fix_typos)[1]:
            if e.label == "LOCATION":
                return e.value[0]
    return OTHER


def place_score(a, b):
    """1 for the same place, 0.5 for another place on the same campus, 0 otherwise."""
    first, second = PLACES.get(a, {}), PLACES.get(b, {})
    if not first.get("campus") or not second.get("campus"):
        return 0.0
    if a == b:
        return 1.0
    return 0.5 if first["campus"] == second["campus"] else 0.0
