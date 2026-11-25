# FindIt Lost and Found System

FindIt is a campus lost-and-found web application for the Student Welfare and Formation Office (SWAFO) at De La Salle University–Dasmariñas. It replaces a paper logbook with a searchable inventory where students and employees can report lost or found items, review possible matches, submit claims, and communicate with the office.

## Features

- Public browsing and search for open found-item records
- Lost-item and found-item reporting with descriptions, categories, locations, dates, photos, brands, and private identifying details
- Account registration, login, profile settings, and report history
- Claim submission with ownership evidence for staff review
- In-app messaging between users and administrators
- Admin dashboards for reports, found items, claims, users, messages, settings, and analytics
- Match suggestions that combine NLP text similarity with item category, campus location, and date signals
- Campus-aware location aliases such as CBAA, GMH, MAH, and library names

## Technology

- Python 3.9+
- Flask
- Flask-SQLAlchemy and SQLAlchemy
- SQLite
- HTML, CSS, and vanilla JavaScript
- Werkzeug password hashing
- Standard-library NLP algorithms

## NLP matching pipeline

FindIt includes a transparent, rule-based matching pipeline in `backend/algorithms/`.

1. Text is normalized, lowercased, tokenized, and lightly stemmed.
2. Common English and Filipino stop words are filtered from lexical features.
3. Gazetteer-based entity recognition identifies item types, brands, colors, materials, and campus locations.
4. Bounded Levenshtein distance helps correct selected spelling errors in recognized entities.
5. TF-IDF vectors and cosine similarity compare report text.
6. The final ranking combines text similarity with location, category, and date signals.
7. Public browse search uses the project's Boyer–Moore string-search implementation.

The match score is a ranking aid for staff review. It is not a probability of ownership, and an approved claim still requires verification.

## Project structure

```text
backend/
  app.py                       Flask application, models, routes, and APIs
  local_startup.py             Local environment setup and startup checks (used by app.py)
  create_admin.py              Creates an administrator account
  reset_password.py            Sets a new password for an existing account
  algorithms/
    textutils.py               Tokenization, normalization, stemming, stop words
    ner.py                     Entity and campus-location recognition
    tfidf.py                   TF-IDF indexing and report matching
    levenshtein_distance.py    Bounded edit distance and typo correction
    boyer_moore.py             Exact string search
templates/                     Public and admin HTML views
static/css/                    Public stylesheets
static/js/                     Public page behavior and API clients
static/admin/                  Admin stylesheets and JavaScript
instance/                      Local SQLite database (created on first run, not in the repository)
static/uploads/                Uploaded photos (created on first run, not in the repository)
```

## Run locally on Windows

Install a current [Python 3 release](https://www.python.org/downloads/) with the `py` launcher. Python 3.13 is recommended. Open the project folder in VS Code, then run these commands from its terminal:

```powershell
cd backend
py app.py
```

On the first run, FindIt creates `backend/.venv` and installs the packages in `backend/requirements.txt`, so it needs an internet connection. Later runs reuse that environment offline. If Windows does not recognize `py`, use `python app.py`.

Open the URL printed after `Running on`. The usual address is `http://127.0.0.1:5000`. If port 5000 is busy, FindIt picks a free port. To choose one yourself, run `py app.py --port 5001`. Keep the terminal open while using FindIt, and press **Ctrl+C** to stop it.

FindIt checks that it can write to `instance/` for reports and `static/uploads/` for photos. If startup reports a write error, check the path shown in the terminal, make sure the project folder is writable, and check that the drive has free space.

On macOS or Linux, run `python3 app.py` from `backend` with Python's `venv` and `pip` support installed.

## Administrator accounts

A direct local run of `app.py` creates a starter admin when the database has none. To create an admin yourself, set these values in the terminal first. Never commit real credentials or secret keys.

```powershell
$env:ADMIN_NAME = "SWAFO Administrator"
$env:ADMIN_SCHOOL_ID = "ADMIN-001"
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_PASSWORD = "use-a-strong-password"

cd backend
py create_admin.py
```

To set a new password for an existing account (admin or student):

```powershell
$env:EMAIL = "admin@example.com"
$env:NEW_PASSWORD = "use-a-strong-password"
py reset_password.py
```

For a public deployment, set a strong `SECRET_KEY` and `SESSION_COOKIE_SECURE=1`. The development fallback key is not safe for public hosting.

## Move the project to another computer

Keep `backend`, `templates`, and `static` together. To move existing records and photos, stop FindIt first, then copy the `instance` folder and keep the `static/uploads` folder inside the copy of `static`. For a fresh database, leave out `instance` and `static/uploads`. FindIt creates both folders as needed. Leave out `backend/.venv` so each computer sets up its own environment.

## Data and privacy

The SQLite database and uploaded photos are local runtime data. Keep `instance/`, `static/uploads/`, and other private files out of public repositories (the `.gitignore` excludes them). Public item fields are separated from private identifying details so staff can verify ownership without exposing every detail in the browse view.

Before deploying, review authentication, session configuration, upload limits, email settings, database backups, and access controls for the environment where the system will run.

## Development notes

- Keep the category list in `static/js/item-store.js` aligned with the backend category definitions.
- Keep the campus location vocabulary in `static/js/data/locations.js` aligned with the backend entity recognizer.
- Do not use claim evidence, private messages, or personal identifiers as public search content.
- When changing matching behavior, test both true matches and reports with no valid match.

## License

No license has been included yet. Add a license file before publishing the repository for reuse by others.
