from base64 import b64decode
import json
import os
import uuid

from datetime import date, datetime, timezone, timedelta
from functools import wraps

if __name__ == '__main__':
    from local_startup import prepare_local_run, serve_locally

    local_options = prepare_local_run()

from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import backref, selectinload
from werkzeug.security import generate_password_hash, check_password_hash

import algorithms  # NER, TF-IDF, Levenshtein and Boyer-Moore, one file each (algorithms/)

# This file is in backend/. The pages (templates/), their CSS, JS and images (static/) and the
# database (instance/database.db) are one folder up, in the project folder.
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

app = Flask(
    __name__,
    template_folder=os.path.join(PROJECT_DIR, 'templates'),
    static_folder=os.path.join(PROJECT_DIR, 'static'),
    instance_path=os.path.join(PROJECT_DIR, 'instance'),
)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-only-change-me')

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'  # a relative path is in instance/

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
# On the public HTTPS site set SESSION_COOKIE_SECURE=1 (see DEPLOY.md), so the login cookie is
# never sent over plain HTTP. Leave it unset locally: http://localhost would then lose logins.
app.config['SESSION_COOKIE_SECURE'] = __name__ != '__main__' and os.environ.get('SESSION_COOKIE_SECURE') == '1'
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # reject request bodies over 10 MB

UPLOAD_DIR = os.path.join(app.static_folder, 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)
UPLOAD_URL_PREFIX = '/static/uploads/'
IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
PROOF_EXTENSIONS = IMAGE_EXTENSIONS | {'pdf'}

db = SQLAlchemy(app)

# One list for the whole site. Keep these in sync with js/item-store.js.
CATEGORIES = ["Electronics", "Bags", "Clothing", "ID & Docs", "Accessories", "Others"]
ITEM_STATUSES = ["pending", "matched", "ready", "claimed"]
OPEN_ITEM_STATUSES = ('pending', 'matched')
RESERVED_CLAIM_STATUSES = ('approved', 'released')
TRACKED_CLAIM_STATUSES = ('pending', *RESERVED_CLAIM_STATUSES)


def utcnow():
    """Naive UTC time (SQLite does not store time zones)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(100), nullable=False)
    school_id = db.Column(db.String(50), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='user')  # 'user' | 'admin'
    created_at = db.Column(db.DateTime, default=utcnow)
    phone = db.Column(db.String(30))
    photo = db.Column(db.Text)

    items = db.relationship('Item', backref='reporter', lazy=True)

    def __repr__(self):
        return f"<User {self.email}>"


class ReportSequence(db.Model):
    __tablename__ = 'report_sequence'
    id = db.Column(db.Integer, primary_key=True)
    last_id = db.Column(db.Integer, nullable=False)


class RecordSequence(db.Model):
    __tablename__ = 'record_sequence'
    table_name = db.Column(db.String(20), primary_key=True)
    last_id = db.Column(db.Integer, nullable=False)


class Item(db.Model):
    """Both lost reports and found items live here; report_type tells them apart."""
    __tablename__ = 'items'
    id = db.Column(db.Integer, primary_key=True)
    reference_code = db.Column(db.String(20), unique=True)        
    report_type = db.Column(db.String(10), nullable=False)        
    item_name = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    color = db.Column(db.String(50))
    description = db.Column(db.Text)
    location = db.Column(db.String(150), nullable=False)            # a location id from js/data/locations.js
    location_other = db.Column(db.String(150))                      # what was typed for "Other / Not sure"
    location_details = db.Column(db.String(500))
    event_date = db.Column(db.Date, nullable=False)                 
    image = db.Column(db.String(255))                              

    # PRIVATE: only SWAFO (and the owner proving a claim) should ever see these.
    brand = db.Column(db.String(100))
    identifying_details = db.Column(db.Text)
    storage = db.Column(db.String(100))
    turned_in_by = db.Column(db.String(100))

    item_now = db.Column(db.String(20))                           
    contact_phone = db.Column(db.String(30))
    status = db.Column(db.String(20), nullable=False, default='pending')
    added_by_admin = db.Column(db.Boolean, default=False)
    date_reported = db.Column(db.DateTime, default=utcnow)
    reporter_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)

    def to_public(self):
        """Safe for anyone. Never add brand, identifying details, storage or turned-in-by here."""
        iso = self.event_date.isoformat() if self.event_date else None
        return {
            "id": self.reference_code,
            "type": self.report_type,
            "name": self.item_name,
            "category": self.category,
            "color": self.color or "",
            "description": self.description or "",
            "location": self.location,             # same as locationId; kept for older callers
            "locationId": self.location,
            "locationOther": self.location_other or "",
            "locationDetails": self.location_details or "",
            "dateFound": iso if self.report_type == 'found' else None,
            "dateLost": iso if self.report_type == 'lost' else None,
            "dateReported": self.date_reported.isoformat() + "Z" if self.date_reported else None,
            "status": self.status,
            "image": self.image,
        }

    def nlp_record(self, *, include_private=True):
        """Return matching inputs. Student suggestions use public fields only."""
        record = {
            "id": self.reference_code,
            "type": self.report_type,
            "status": self.status,
            "name": self.item_name,
            "category": self.category,
            "color": self.color or "",
            "description": self.description or "",
            "location": self.location,
            "location_other": self.location_other or "",
            "location_details": self.location_details or "",
            "event_date": self.event_date,
        }
        if include_private:
            record.update(brand=self.brand or '', identifying_details=self.identifying_details or '')
        return record

    def _texts(self):
        return (self.item_name, self.color, self.description, self.location_other,
                self.location_details, self.brand, self.identifying_details)

    def entities(self):
        """NER over everything written about the item. Admin only: the brand and details are private."""
        return algorithms.entity_summary(*self._texts())

    def typos(self):
        """The typos NER read as dictionary words (Levenshtein), in the same text as entities()."""
        return algorithms.typo_fixes(*self._texts())

    def to_private(self):
        """Admin only."""
        data = self.to_public()
        data.update({
            "brand": self.brand or "",
            "identifyingDetails": self.identifying_details or "",
            "storage": self.storage or "",
            "turnedInBy": self.turned_in_by or "",
            "itemNow": self.item_now,
            "addedByAdmin": bool(self.added_by_admin),
            "reporter": {
                "id": self.reporter.id,
                "name": self.reporter.full_name,
                "email": self.reporter.email,
                "schoolId": self.reporter.school_id,
                "phone": self.contact_phone or "",
            },
        })
        return data

class MatchDismissal(db.Model):
    __tablename__ = 'match_dismissals'
    lost_id = db.Column(db.Integer, db.ForeignKey('items.id', ondelete='CASCADE'), primary_key=True)
    found_id = db.Column(db.Integer, db.ForeignKey('items.id', ondelete='CASCADE'), primary_key=True)


class Claim(db.Model):
    __tablename__ = 'claims'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id'), nullable=False)
    claimant_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    lost_report_id = db.Column(db.Integer, db.ForeignKey('items.id', ondelete='SET NULL'), index=True)
    brand = db.Column(db.String(100))
    identifiers = db.Column(db.Text, nullable=False)
    lost_location = db.Column(db.String(150))
    lost_date = db.Column(db.Date)
    proof_files = db.Column(db.Text, default='[]')                  # JSON list of upload paths
    status = db.Column(db.String(20), nullable=False, default='pending')  # pending|approved|rejected|released
    admin_note = db.Column(db.Text)
    date_submitted = db.Column(db.DateTime, default=utcnow)
    reviewed_at = db.Column(db.DateTime)

    item = db.relationship('Item', foreign_keys=[item_id], backref='claims')
    lost_report = db.relationship('Item', foreign_keys=[lost_report_id],
                                  backref=backref('source_claims', passive_deletes=True))
    claimant = db.relationship('User', backref='claims')

    @property
    def reference(self):
        return f"CL-{self.id:04d}"

    def to_dict(self, admin=False):
        data = {
            "id": self.id,
            "reference": self.reference,
            "itemRef": self.item.reference_code,
            "itemName": self.item.item_name,
            "image": self.item.image,
            "status": self.status,
            "dateSubmitted": self.date_submitted.isoformat() + "Z",
            "reviewedAt": self.reviewed_at.isoformat() + "Z" if self.reviewed_at else None,
            "adminNote": self.admin_note or "",
        }
        if admin:
            data.update({
                "brand": self.brand or "",
                "identifiers": self.identifiers,
                "lostLocation": self.lost_location or "",
                "lostDate": self.lost_date.isoformat() if self.lost_date else None,
                "proofFiles": json.loads(self.proof_files or '[]'),
                # Typos and brand names count: "Samsng" and "Galaxy" both match Samsung (algorithms/levenshtein_distance.py)
                "brandMatches": algorithms.brand_matches(self.item.brand, self.brand),
                "claimant": {
                    "name": self.claimant.full_name,
                    "email": self.claimant.email,
                    "schoolId": self.claimant.school_id,
                    "phone": self.claimant.phone or "",
                },
                # With its private fields, so SWAFO can check the claimant's answers against them.
                "item": self.item.to_private(),
            })
        return data


class Message(db.Model):
    """One conversation per student; every row belongs to that student's thread with SWAFO."""
    __tablename__ = 'messages'
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    sender = db.Column(db.String(10), nullable=False)               # 'user' | 'swafo' | 'system'
    text = db.Column(db.Text)
    image = db.Column(db.Text)                                      # small data: URL from photos.js
    time = db.Column(db.DateTime, default=utcnow)
    read_by_user = db.Column(db.Boolean, default=False)
    read_by_swafo = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            "id": self.id,
            "sender": self.sender,
            "text": self.text or "",
            "image": self.image,
            "time": self.time.isoformat() + "Z",
        }


def current_user():
    """The logged-in User row, or None. Reads the role from the database, not the cookie."""
    data = session.get('user')
    return db.session.get(User, data['id']) if data else None


def api_error(code, status=400):
    return jsonify({"error": code}), status


def clean(value, limit):
    return value.strip()[:limit] if isinstance(value, str) else ''


def json_object():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def parse_date(text):
    """'2026-10-16' -> date, or None if empty. Raises ValueError if invalid."""
    text = (text or "").strip()
    return date.fromisoformat(text) if text else None


def matches_file_format(header, extension):
    signatures = {
        'png': (b'\x89PNG\r\n\x1a\n',),
        'jpg': (b'\xff\xd8\xff',),
        'jpeg': (b'\xff\xd8\xff',),
        'gif': (b'GIF87a', b'GIF89a'),
    }
    if extension == 'webp':
        return header[:4] == b'RIFF' and header[8:12] == b'WEBP'
    if extension == 'pdf':
        return b'%PDF-' in header[:1024]
    return header.startswith(signatures.get(extension, ()))


def valid_image_data_url(value):
    if not isinstance(value, str) or len(value) > 2_000_000 or not value.startswith('data:image/'):
        return False
    mime, separator, data = value.partition(';base64,')
    extension = mime.removeprefix('data:image/')
    if not separator or extension not in IMAGE_EXTENSIONS:
        return False
    try:
        header = b64decode(data, validate=True)[:12]
    except ValueError:
        return False
    return matches_file_format(header, extension)


def save_upload(file_storage, allowed):
    """Saves an uploaded file under a random name; returns its URL path or None if no file."""
    if not file_storage or not file_storage.filename:
        return None
    name = file_storage.filename
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if ext not in allowed:
        raise ValueError('bad_file_type')
    saved_name = f'{uuid.uuid4().hex}.{ext}'
    partial_name = saved_name + '.part'
    try:
        header = file_storage.stream.read(1024)
        file_storage.stream.seek(0)
        if not header:
            raise ValueError('empty_file')
        if not matches_file_format(header, ext):
            raise ValueError('bad_file_type')
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        partial_path = os.path.join(UPLOAD_DIR, partial_name)
        file_storage.save(partial_path)
        os.replace(partial_path, os.path.join(UPLOAD_DIR, saved_name))
    except OSError:
        app.logger.exception('Could not save an attachment in %s', UPLOAD_DIR)
        remove_upload(UPLOAD_URL_PREFIX + partial_name)
        raise
    return UPLOAD_URL_PREFIX + saved_name


def remove_upload(url_path):
    """Deletes a file save_upload() stored, given its URL path. Ignores anything else."""
    if not url_path or not url_path.startswith(UPLOAD_URL_PREFIX):
        return
    path = os.path.join(UPLOAD_DIR, os.path.basename(url_path))
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        app.logger.warning('Could not remove attachment %s', path, exc_info=True)


def login_required(f):
    """For pages: send visitors who are not logged in to the login page."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return wrapper


def admin_required(f):
    """For pages: admins only."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None or user.role != 'admin':
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return wrapper


def api_login_required(f):
    """For API routes: answers 401 JSON instead of redirecting."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return api_error('login_required', 401)
        return f(*args, **kwargs)
    return wrapper


def api_admin_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None:
            return api_error('login_required', 401)
        if user.role != 'admin':
            return api_error('forbidden', 403)
        return f(*args, **kwargs)
    return wrapper


@app.errorhandler(413)
def file_too_large(_error):
    return api_error('file_too_large', 413)

def build_matchers():
    """TF-IDF matchers over every report (algorithms/tfidf.py), built per request so they're never stale: the
    real one, and one that reads the reports without Levenshtein typo fixes, to show what they add."""
    records = [item.nlp_record() for item in Item.query.all()]
    return algorithms.Matcher(records), algorithms.Matcher(records, fix_typos=False)

# ---------------------------- Pages Section ------------------------------- #

@app.route('/')
def index(): return render_template('index.html')

@app.route('/browse')
def browse_items(): return render_template('items.html')

@app.route('/item-details')
def item_details(): return render_template('item-details.html')

@app.route('/claim')
def claim_item(): return render_template('claim.html')

@app.route('/report')
def report(): return render_template('report.html')

@app.route('/report-form')
def report_form(): return render_template('report-form.html')

@app.route('/report-submitted')
def report_submitted(): return render_template('report-submitted.html')

@app.route('/my-reports')
@login_required
def my_reports():
    user = current_user()
    if user.role == 'admin':
        return redirect('/admin/dashboard')
    return render_template('my-reports.html')

@app.route('/messages')
@login_required
def messages(): return render_template('messages.html')

@app.route('/settings')
@login_required
def settings():
    return render_template('settings.html')

@app.route('/about')
def about(): return render_template('about.html')

@app.route('/signup')
def signup(): return render_template('signup.html')

@app.route('/login')
def login():
    user = current_user()
    if user is not None:
        return redirect('/admin/dashboard' if user.role == 'admin' else '/')
    return render_template('login.html')

# Admin pages
@app.route('/admin')
@app.route('/admin/dashboard')
@admin_required
def admin_dashboard(): return render_template('admin/dashboard.html')

@app.route('/admin/claims')
@admin_required
def admin_claims():
    return render_template('admin/claims.html')

@app.route('/admin/reports')
@admin_required
def admin_reports(): return render_template('admin/reports.html')

@app.route('/admin/found-items')
@admin_required
def admin_found_items(): return render_template('admin/found-items.html')

@app.route('/admin/messages')
@admin_required
def admin_admin_messages(): return render_template('admin/messages.html')

@app.route('/admin/users')
@admin_required
def admin_users(): return render_template('admin/users.html')

@app.route('/admin/analytics')
@admin_required
def admin_analytics(): return render_template('admin/analytics.html')

@app.route('/admin/settings')
@admin_required
def admin_settings(): return render_template('admin/settings.html')


# Old "items.html"-style links redirect to the real route. Remove once no .html links are left.
LEGACY_PAGES = {
    'index.html': '/', 'items.html': '/browse', 'item-details.html': '/item-details',
    'claim.html': '/claim', 'report.html': '/report', 'report-form.html': '/report-form',
    'report-submitted.html': '/report-submitted', 'my-reports.html': '/my-reports',
    'messages.html': '/messages', 'about.html': '/about', 'login.html': '/login',
    'signup.html': '/signup','settings.html': '/settings',
}

@app.route('/<page>.html')
def legacy_html(page):
    target = LEGACY_PAGES.get(f'{page}.html')
    if not target:
        return 'Not found', 404
    query = request.query_string.decode()
    return redirect(f'{target}?{query}' if query else target)


ADMIN_LEGACY_PAGES = {
    'dashboard.html': '/admin/dashboard', 'claims.html': '/admin/claims',
    'reports.html': '/admin/reports', 'found-items.html': '/admin/found-items',
    'messages.html': '/admin/messages', 'analytics.html': '/admin/analytics',
    'settings.html': '/admin/settings', 'users.html': '/admin/users',
}

@app.route('/admin/<page>.html')
def legacy_admin_html(page):
    target = ADMIN_LEGACY_PAGES.get(f'{page}.html')
    if not target:
        return 'Not found', 404
    query = request.query_string.decode()
    return redirect(f'{target}?{query}' if query else target)


# ==========================================
# Auth API
# ==========================================

@app.route('/api/auth/signup', methods=['POST'])
def api_signup():
    data = json_object()
    full_name = clean(data.get('fullName'), 100)
    school_id = clean(data.get('schoolId'), 50)
    email = clean(data.get('email'), 120).lower()
    password = data.get('password') or ''

    if not all([full_name, school_id, email, password]) or not isinstance(password, str):
        return api_error('missing_fields')
    if len(password) < 8:
        return api_error('weak_password')

    existing = User.query.filter((User.email == email) | (User.school_id == school_id)).first()
    if existing:
        return api_error('user_exists')

    user = User(
        full_name=full_name,
        school_id=school_id,
        email=email,
        password_hash=generate_password_hash(password, method='scrypt'),
        role='user',
    )
    try:
        db.session.add(user)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return api_error('database_error', 500)
    return jsonify({"success": True, "message": "Account created successfully!"}), 201


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = json_object()
    email = clean(data.get('email'), 120).lower()
    password = data.get('password') or ''
    role = data.get('role')

    user = User.query.filter_by(email=email).first()
    if not user or not isinstance(password, str) or not check_password_hash(user.password_hash, password):
        return api_error('credentials', 401)
    if role and user.role != role:
        return api_error('role', 401)

    session['user'] = {'id': user.id, 'name': user.full_name, 'email': user.email, 'role': user.role}
    return jsonify({"session": session['user']})

def user_payload(user):
    return {'id': user.id, 'name': user.full_name, 'email': user.email,
            'role': user.role, 'phone': user.phone or '', 'photo': user.photo}


@app.route('/api/auth/me', methods=['GET'])
def api_current_user():
    user = current_user()
    if user is None:
        return jsonify(None), 401
    return jsonify(user_payload(user))


@app.route('/api/auth/profile', methods=['PATCH'])
@api_login_required
def api_update_profile():
    user = current_user()
    data = json_object()

    if 'fullName' in data:
        name = clean(data['fullName'], 100)
        if not name:
            return api_error('missing_fields')
        user.full_name = name

    if 'phone' in data:
        user.phone = clean(data['phone'], 30)

    if 'photo' in data:
        photo = data['photo']
        if photo not in (None, '', user.photo) and not valid_image_data_url(photo):
            return api_error('bad_image')
        user.photo = photo or None

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return api_error('database_error', 500)

    session['user'] = {'id': user.id, 'name': user.full_name,
                       'email': user.email, 'role': user.role}
    return jsonify(user_payload(user))


@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({"success": True})


@app.route('/api/auth/change-password', methods=['POST'])
@api_login_required
def api_change_password():
    user = current_user()
    data = json_object()
    current_password = data.get('currentPassword') or ''
    new_password = data.get('newPassword') or ''

    if not isinstance(current_password, str) or not check_password_hash(user.password_hash, current_password):
        return api_error('wrong_password', 403)
    if not isinstance(new_password, str) or len(new_password) < 8:
        return api_error('weak_password')
    if new_password == current_password:
        return api_error('same_password')

    user.password_hash = generate_password_hash(new_password, method='scrypt')
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return api_error('database_error', 500)
    return jsonify({"success": True})


# ==========================================
# 7. ITEMS API
# ==========================================


@app.route('/api/items', methods=['GET'])
def api_items():
    """Public Browse list: found items that are not claimed yet. Never includes private fields."""
    query = Item.query.filter(Item.report_type == 'found', Item.status != 'claimed')
    q = clean(request.args.get('q'), 100)
    if q:
        like = f'%{q}%'
        query = query.filter(
            Item.item_name.ilike(like) | Item.category.ilike(like) |
            Item.color.ilike(like) | Item.description.ilike(like) | Item.location.ilike(like)
        )
    items = query.order_by(Item.event_date.desc(), Item.id.desc()).all()
    return jsonify([i.to_public() for i in items])


@app.route('/api/items/<code>', methods=['GET'])
def api_item(code):
    item = Item.query.filter_by(reference_code=code).first()
    if item is None:
        return api_error('not_found', 404)

    user = current_user()
    if user is not None and user.role == 'admin':
        return jsonify(item.to_private())
    if user is not None and item.reporter_id == user.id:
        return jsonify(item.to_public())
    # Everyone else may only see found items that are still available.
    if item.report_type != 'found' or item.status == 'claimed':
        return api_error('not_found', 404)
    return jsonify(item.to_public())


@app.route('/api/items', methods=['POST'])
@api_login_required
def api_create_item():
    """The report form (multipart/form-data) and the admin 'Add found item' form both post here."""
    user = current_user()
    form = request.form

    report_type = form.get('type', '')
    if report_type not in ('lost', 'found'):
        return api_error('invalid_type')

    name = clean(form.get('itemName'), 100)
    category = form.get('category', '')
    description = clean(form.get('description'), 2000)
    location = clean(form.get('locationId'), 150)
    if not all([name, category, description, location, form.get('date')]):
        return api_error('missing_fields')
    if category not in CATEGORIES:
        return api_error('invalid_category')

    try:
        event_date = parse_date(form.get('date'))
    except ValueError:
        return api_error('invalid_date')
    if event_date is None:
        return api_error('invalid_date')
    if event_date > date.today():
        return api_error('future_date')

    try:
        image = save_upload(request.files.get('photo'), IMAGE_EXTENSIONS)
    except ValueError as error:
        return api_error(str(error))
    except OSError:
        return api_error('upload_error', 500)
    if report_type == 'found' and not image:
        return api_error('photo_required')

    item_now = form.get('itemNow') if form.get('itemNow') in ('swafo', 'with-me') else None
    is_admin = user.role == 'admin'

    item = Item(
        report_type=report_type,
        item_name=name,
        category=category,
        color=clean(form.get('color'), 50),
        description=description,
        location=location,
        # The typed place only means something for "Other / Not sure".
        location_other=clean(form.get('locationOther'), 150) if location == 'other' else None,
        location_details=clean(form.get('locationDetails'), 500),
        event_date=event_date,
        image=image,
        brand=clean(form.get('brand'), 100),
        identifying_details=clean(form.get('identifyingDetails'), 2000),
        item_now=item_now if report_type == 'found' else None,
        contact_phone=clean(form.get('phone'), 30),
        storage=clean(form.get('storage'), 100) if is_admin else None,
        turned_in_by=clean(form.get('turnedInBy'), 100) if is_admin else None,
        added_by_admin=is_admin,
        reporter_id=user.id,
    )
    try:
        # Allocate an ID that cannot be reused after the last report is deleted.
        connection = db.session.connection()
        connection.exec_driver_sql('''
            UPDATE report_sequence
            SET last_id = MAX(last_id, (SELECT COALESCE(MAX(id), 0) FROM items)) + 1
            WHERE id = 1
        ''')
        item.id = db.session.get(ReportSequence, 1).last_id
        item.reference_code = f'FI-{item.id:04d}'
        db.session.add(item)
        db.session.commit()
    except Exception as error:
        db.session.rollback()
        remove_upload(image)
        app.logger.error('Could not save a report (%s)', type(error).__name__)
        return api_error('database_error', 500)

    return jsonify({"success": True, "reference": item.reference_code}), 201


def can_delete_report(item):
    return item.status == 'pending' and not item.claims and not item.source_claims


def open_found_items():
    return Item.query.filter(
        Item.report_type == 'found', Item.status.in_(OPEN_ITEM_STATUSES), Item.reference_code != '',
        ~Item.claims.any(Claim.status.in_(RESERVED_CLAIM_STATUSES)),
    )


def own_open_lost_report(user_id, reference):
    return Item.query.filter(
        Item.reference_code == reference, Item.reporter_id == user_id,
        Item.report_type == 'lost', Item.status.in_(OPEN_ITEM_STATUSES),
    ).first()


def active_claim_on_lost_report(lost_id):
    return Claim.query.filter(Claim.lost_report_id == lost_id,
                              Claim.status.in_(TRACKED_CLAIM_STATUSES)).first()


def student_matches(user_id, lost_items, claims):
    if not lost_items:
        return {}
    own_claimed_items = {claim.item_id for claim in claims}
    found_items = [item for item in open_found_items().filter(Item.reporter_id != user_id)
                   .order_by(Item.id).all() if item.id not in own_claimed_items]
    if not found_items:
        return {}

    dismissed = {}
    for entry in MatchDismissal.query.filter(MatchDismissal.lost_id.in_([item.id for item in lost_items])):
        dismissed.setdefault(entry.lost_id, set()).add(entry.found_id)

    matcher = algorithms.Matcher([item.nlp_record(include_private=False) for item in lost_items + found_items])
    found_by_reference = {item.reference_code: item for item in found_items}
    matches = {}
    for lost in lost_items:
        excluded = {found.reference_code for found in found_items
                    if found.id in dismissed.get(lost.id, ())
                    or (lost.event_date and found.event_date and (found.event_date - lost.event_date).days < -1)}
        best = matcher.best(lost.reference_code, exclude_ids=excluded)
        if best:
            matches[lost.id] = {'item': found_by_reference[best['id']].to_public(), 'score': best['score']}
    return matches


@app.route('/api/my-reports', methods=['GET'])
@api_login_required
def api_my_reports():
    user = current_user()
    items = (Item.query.filter_by(reporter_id=user.id)
             .options(selectinload(Item.claims), selectinload(Item.source_claims))
             .order_by(Item.date_reported.desc()).all())
    claims = (Claim.query.filter_by(claimant_id=user.id).options(selectinload(Claim.item))
              .order_by(Claim.date_submitted.desc(), Claim.id.desc()).all())
    claim_details = {claim.id: dict(claim.to_dict(), item=claim.item.to_public()) for claim in claims}
    linked_claims = {}
    rejected_claims = {}
    for claim in claims:
        if claim.lost_report_id:
            target = linked_claims if claim.status in TRACKED_CLAIM_STATUSES else rejected_claims
            target.setdefault(claim.lost_report_id, claim_details[claim.id])
    lost_items = [item for item in items if item.report_type == 'lost' and item.reference_code
                  and item.status in OPEN_ITEM_STATUSES
                  and item.id not in linked_claims]
    matches = student_matches(user.id, lost_items, claims)

    reports = []
    for item in items:
        match = matches.get(item.id)
        linked_claim = linked_claims.get(item.id) or (rejected_claims.get(item.id) if match is None else None)
        reports.append(dict(item.to_public(), canDelete=can_delete_report(item),
                            match=match, linkedClaim=linked_claim))
    return jsonify({
        "reports": reports,
        "claims": list(claim_details.values()),
    })


@app.route('/api/my-reports/<code>/dismiss-match', methods=['POST'])
@api_login_required
def api_dismiss_report_match(code):
    found_reference = clean(json_object().get('foundReference'), 20)
    if not found_reference:
        return api_error('missing_fields')
    user_id = current_user().id
    try:
        db.session.connection().exec_driver_sql('BEGIN IMMEDIATE')
        lost = own_open_lost_report(user_id, code)
        found = open_found_items().filter(Item.reference_code == found_reference,
                                         Item.reporter_id != user_id).first()
        if lost is None or found is None:
            db.session.rollback()
            return api_error('not_found', 404)
        if active_claim_on_lost_report(lost.id):
            db.session.rollback()
            return api_error('report_has_claim', 409)
        if db.session.get(MatchDismissal, (lost.id, found.id)) is None:
            db.session.add(MatchDismissal(lost_id=lost.id, found_id=found.id))
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        return api_error('database_error', 500)
    return jsonify(success=True)


@app.route('/api/my-reports', methods=['DELETE'])
@api_login_required
def api_cancel_reports():
    references = json_object().get('references')
    if (not isinstance(references, list) or not references
            or any(not isinstance(code, str) or not code.strip() for code in references)):
        return api_error('invalid_selection')
    return delete_own_reports(set(references), include_count=True)


@app.route('/api/my-reports/<code>', methods=['DELETE'])
@api_login_required
def api_cancel_report(code):
    return delete_own_reports({code})


def delete_own_reports(references, *, include_count=False):
    user_id = current_user().id
    try:
        # Lock before checking status and claims so another write cannot change eligibility.
        db.session.connection().exec_driver_sql('BEGIN IMMEDIATE')
        items = (Item.query.filter(Item.reporter_id == user_id, Item.reference_code.in_(references))
                 .options(selectinload(Item.claims), selectinload(Item.source_claims)).all())
        if len(items) != len(references):
            db.session.rollback()
            return api_error('not_found', 404)
        if any(not can_delete_report(item) for item in items):
            db.session.rollback()
            return api_error('not_pending', 409)

        images = [item.image for item in items]
        for item in items:
            db.session.delete(item)
        db.session.commit()
    except Exception as error:
        db.session.rollback()
        app.logger.error('Could not delete reports (%s)', type(error).__name__)
        return api_error('database_error', 500)

    for image in images:
        remove_upload(image)
    result = {'success': True}
    if include_count:
        result['deletedCount'] = len(items)
    return jsonify(result)


# ==========================================
# 8. CLAIMS API
# ==========================================

def claim_targets(user_id, item_reference, lost_reference):
    item = open_found_items().filter(Item.reference_code == item_reference).first()
    if item is None:
        return None, None, 'item_unavailable'
    if item.reporter_id == user_id:
        return None, None, 'own_item'
    duplicate = Claim.query.filter(Claim.item_id == item.id, Claim.claimant_id == user_id,
                                   Claim.status.in_(TRACKED_CLAIM_STATUSES)).first()
    if duplicate:
        return None, None, 'duplicate_claim'

    lost = None
    if lost_reference:
        lost = own_open_lost_report(user_id, lost_reference)
        if lost is None:
            return None, None, 'report_unavailable'
        if active_claim_on_lost_report(lost.id):
            return None, None, 'report_has_claim'
    return item, lost, None


def claim_target_error(code):
    statuses = {'item_unavailable': 404, 'report_unavailable': 404, 'own_item': 403,
                'duplicate_claim': 409, 'report_has_claim': 409}
    return api_error(code, statuses[code])


@app.route('/api/claims', methods=['POST'])
@api_login_required
def api_create_claim():
    user_id = current_user().id
    form = request.form
    item_reference = clean(form.get('itemId'), 20)
    lost_reference = clean(form.get('lostReportId'), 20)
    _, _, error_code = claim_targets(user_id, item_reference, lost_reference)
    if error_code:
        return claim_target_error(error_code)

    identifiers = clean(form.get('identifiers'), 2000)
    if not identifiers or not form.get('certify'):
        return api_error('missing_fields')

    try:
        lost_date = parse_date(form.get('lostDate'))
    except ValueError:
        return api_error('invalid_date')

    files = [file for file in request.files.getlist('proof') if file.filename]
    if len(files) > 5:
        return api_error('too_many_files')

    proofs = []
    try:
        for file in files:
            proofs.append(save_upload(file, PROOF_EXTENSIONS))
    except (ValueError, OSError) as error:
        for path in proofs:
            remove_upload(path)
        if isinstance(error, ValueError):
            return api_error(str(error))
        return api_error('upload_error', 500)

    try:
        # Recheck after uploads under the write lock, in case another claim was approved meanwhile.
        db.session.connection().exec_driver_sql('BEGIN IMMEDIATE')
        item, lost, error_code = claim_targets(user_id, item_reference, lost_reference)
        if error_code:
            db.session.rollback()
            for path in proofs:
                remove_upload(path)
            return claim_target_error(error_code)
        claim = Claim(
            item_id=item.id,
            claimant_id=user_id,
            lost_report_id=lost.id if lost else None,
            brand=clean(form.get('brand'), 100),
            identifiers=identifiers,
            lost_location=clean(form.get('lostLocation'), 150),
            lost_date=lost_date,
            proof_files=json.dumps(proofs),
        )
        db.session.add(claim)
        db.session.commit()
    except Exception as error:
        db.session.rollback()
        for path in proofs:
            remove_upload(path)
        app.logger.error('Could not save a claim (%s)', type(error).__name__)
        return api_error('database_error', 500)

    return jsonify({"success": True, "claimId": claim.id, "reference": claim.reference,
                    "status": claim.status}), 201


# ==========================================
# 9. ADMIN API
# ==========================================

def admin_delete_transaction(function):
    @api_admin_required
    @wraps(function)
    def run(*args, **kwargs):
        payload = json_object()
        uploads = set()
        try:
            db.session.connection().exec_driver_sql('BEGIN IMMEDIATE')
            response = app.make_response(function(*args, uploads=uploads, payload=payload, **kwargs))
            if response.status_code >= 400:
                db.session.rollback()
                return response
            db.session.commit()
        except SQLAlchemyError as error:
            db.session.rollback()
            app.logger.error('Could not delete admin records (%s)', type(error).__name__)
            return api_error('database_error', 500)

        for path in uploads:
            remove_upload(path)
        return response
    return run


def claim_uploads(claim):
    try:
        files = json.loads(claim.proof_files or '[]')
    except (TypeError, ValueError):
        return ()
    if not isinstance(files, list):
        return ()
    return (path for path in files if isinstance(path, str) and path.startswith(UPLOAD_URL_PREFIX))


def delete_items_and_claims(items, claims, uploads):
    """Stage deletions and collect file paths to remove after committing."""
    removed_items = {item.id for item in items}
    reopen = {claim.item for claim in claims if claim.status == 'approved'
              and claim.item_id not in removed_items}
    for claim in claims:
        uploads.update(claim_uploads(claim))
        db.session.delete(claim)
    db.session.flush()

    for item in reopen:
        active_claim = Claim.query.filter(Claim.item_id == item.id,
                                          Claim.status.in_(['approved', 'released'])).first()
        if item.status == 'ready' and active_claim is None:
            item.status = 'pending'

    for item in items:
        if item.image:
            uploads.add(item.image)
        db.session.delete(item)
    db.session.flush()


@app.route('/api/admin/items', methods=['GET'])
@api_admin_required
def api_admin_items():
    """Every report with its private fields. Unless ?nlp=0, each also has `entities` (what NER
    found in it), `typos` (words it read as dictionary words by Levenshtein distance) and `match`
    (its best TF-IDF match among the open reports of the other type, with the score that pair
    would get without the typo fixes)."""
    report_type = request.args.get('type')
    query = Item.query
    if report_type in ('lost', 'found'):
        query = query.filter_by(report_type=report_type)
    items = query.order_by(Item.date_reported.desc()).all()
    if request.args.get('nlp') == '0':
        return jsonify([i.to_private() for i in items])

    matcher, as_written = build_matchers()
    result = []
    for item in items:
        data = item.to_private()
        data["entities"] = item.entities()
        data["typos"] = item.typos()
        match = matcher.best(item.reference_code) if item.status != 'claimed' else None
        if match:
            match["scoreWithoutTypoFixes"] = as_written.compare(item.reference_code, match["id"])["score"]
        data["match"] = match
        result.append(data)
    return jsonify(result)


@app.route('/api/admin/items', methods=['DELETE'])
@admin_delete_transaction
def api_admin_delete_items(uploads, payload):
    references = payload.get('references')
    if (not isinstance(references, list) or not references
            or any(not isinstance(code, str) or not code.strip() for code in references)):
        return api_error('invalid_selection')
    references = set(references)
    items = Item.query.filter(Item.reference_code.in_(references)).all()
    if len(items) != len(references):
        return api_error('not_found', 404)
    claims = Claim.query.filter(Claim.item_id.in_([item.id for item in items])).all()
    delete_items_and_claims(items, claims, uploads)
    return jsonify(success=True, deletedCount=len(items))


@app.route('/api/admin/items/<code>', methods=['PATCH'])
@api_admin_required
def api_admin_update_item(code):
    item = Item.query.filter_by(reference_code=code).first()
    if item is None:
        return api_error('not_found', 404)

    data = json_object()
    if not data:
        return api_error('missing_fields')
    if 'status' in data:
        if data['status'] not in ITEM_STATUSES:
            return api_error('invalid_status')
        item.status = data['status']
    if 'storage' in data:
        item.storage = clean(data['storage'], 100)
    if 'turnedInBy' in data:
        item.turned_in_by = clean(data['turnedInBy'], 100)
    if 'name' in data:
        name = clean(data['name'], 100)
        if not name:
            return api_error('missing_fields')
        item.item_name = name
    if 'category' in data:
        if data['category'] not in CATEGORIES:
            return api_error('invalid_category')
        item.category = data['category']
    if 'locationId' in data:
        location = clean(data['locationId'], 150)
        if not location:
            return api_error('missing_fields')
        item.location = location
        if location != 'other':
            item.location_other = None
    if 'locationOther' in data and item.location == 'other':
        item.location_other = clean(data['locationOther'], 150) or None
    if 'date' in data:
        try:
            event_date = parse_date(clean(data['date'], 30))
        except ValueError:
            return api_error('invalid_date')
        if event_date is None:
            return api_error('invalid_date')
        if event_date > date.today():
            return api_error('future_date')
        item.event_date = event_date

    try:
        db.session.commit()
    except Exception as error:
        db.session.rollback()
        app.logger.error('Could not update a report (%s)', type(error).__name__)
        return api_error('database_error', 500)
    return jsonify(item.to_private())


@app.route('/api/admin/items/<code>/matches', methods=['GET'])
@api_admin_required
def api_admin_matches(code):
    """Likely matches for one report, best first: a lost report is compared with the open found
    items, and the reverse, by TF-IDF cosine similarity plus place, category and date (algorithms/tfidf.py).
    Each result has its score (0-100), the signals behind it (0-1) and the other report."""
    item = Item.query.filter_by(reference_code=code).first()
    if item is None:
        return api_error('not_found', 404)

    by_code = {other.reference_code: other for other in Item.query.all()}
    matcher = algorithms.Matcher([other.nlp_record() for other in by_code.values()])
    return jsonify([dict(result, item=by_code[result["id"]].to_private())
                    for result in matcher.matches(code)])


@app.route('/api/admin/nlp/entities', methods=['POST'])
@api_admin_required
def api_admin_entities():
    """Runs NER on any text, to try it out: {"text": "..."} -> each entity and a summary per label."""
    text = clean(json_object().get('text'), 5000)
    return jsonify({"entities": algorithms.extract_entities(text), "summary": algorithms.entity_summary(text)})


@app.route('/api/admin/claims', methods=['GET'])
@api_admin_required
def api_admin_claims():
    claims = Claim.query.order_by(Claim.date_submitted.desc()).all()
    return jsonify([c.to_dict(admin=True) for c in claims])


@app.route('/api/admin/claims', methods=['DELETE'])
@admin_delete_transaction
def api_admin_delete_claims(uploads, payload):
    claim_ids = payload.get('claimIds')
    if (not isinstance(claim_ids, list) or not claim_ids
            or any(type(claim_id) is not int or not 0 < claim_id < 2**63 for claim_id in claim_ids)):
        return api_error('invalid_selection')
    claim_ids = set(claim_ids)
    claims = Claim.query.filter(Claim.id.in_(claim_ids)).all()
    if len(claims) != len(claim_ids):
        return api_error('not_found', 404)
    delete_items_and_claims([], claims, uploads)
    return jsonify(success=True, deletedCount=len(claims))


@app.route('/api/admin/users', methods=['GET'])
@api_admin_required
def api_admin_users():
    def counts_by(column):
        return dict(db.session.query(column, db.func.count()).group_by(column).all())

    reports = counts_by(Item.reporter_id)
    claims = counts_by(Claim.claimant_id)
    messages = counts_by(Message.student_id)
    users = User.query.filter_by(role='user').order_by(User.full_name, User.id).all()
    return jsonify([{
        'id': user.id, 'name': user.full_name, 'email': user.email, 'schoolId': user.school_id,
        'reportCount': reports.get(user.id, 0), 'claimCount': claims.get(user.id, 0),
        'messageCount': messages.get(user.id, 0),
    } for user in users])


@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@admin_delete_transaction
def api_admin_delete_user(user_id, uploads, payload):
    user = User.query.filter_by(id=user_id, role='user').first()
    if user is None:
        return api_error('not_found', 404)
    items = Item.query.filter_by(reporter_id=user_id).all()
    claims = Claim.query.filter(or_(Claim.claimant_id == user_id,
                                    Claim.item_id.in_([item.id for item in items]))).all()
    delete_items_and_claims(items, claims, uploads)
    Message.query.filter_by(student_id=user_id).delete(synchronize_session=False)
    db.session.delete(user)
    return jsonify(success=True)


@app.route('/api/admin/claims/<int:claim_id>', methods=['PATCH'])
@api_admin_required
def api_admin_review_claim(claim_id):
    data = json_object()
    try:
        db.session.connection().exec_driver_sql('BEGIN IMMEDIATE')
        claim = db.session.get(Claim, claim_id)
    except SQLAlchemyError:
        db.session.rollback()
        return api_error('database_error', 500)
    if claim is None:
        return api_error('not_found', 404)

    new_status = data.get('status')
    if new_status not in ('approved', 'rejected', 'released'):
        return api_error('invalid_status')

    item = claim.item
    if new_status == 'approved':
        # Only one claim per item can be approved, and a collected item stays collected.
        other_approved = any(c.status in ('approved', 'released') for c in item.claims if c.id != claim.id)
        if item.status == 'claimed' or other_approved:
            return api_error('already_approved', 409)
        claim.status = 'approved'
        item.status = 'ready'
    elif new_status == 'rejected':
        claim.status = 'rejected'
        other_approved = any(c.status == 'approved' for c in item.claims if c.id != claim.id)
        if item.status == 'ready' and not other_approved:
            item.status = 'pending'
    elif new_status == 'released':
        if claim.status != 'approved':
            return api_error('not_approved', 409)
        claim.status = 'released'
        item.status = 'claimed'

    claim.admin_note = clean(data.get('note'), 1000)
    claim.reviewed_at = utcnow()
    try:
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        return api_error('database_error', 500)
    return jsonify(claim.to_dict(admin=True))


# ==========================================
# 10. MESSAGES API
# ==========================================

def read_message_payload():
    """Returns (text, image) from the JSON body, or raises ValueError."""
    data = json_object()
    text = clean(data.get('text'), 2000)
    image = data.get('image')
    if image not in (None, '') and not valid_image_data_url(image):
        raise ValueError('bad_image')
    image = image or None
    if not text and not image:
        raise ValueError('empty_message')
    return text, image


@app.route('/api/messages', methods=['GET'])
@api_login_required
def api_messages():
    user = current_user()
    rows = Message.query.filter_by(student_id=user.id).order_by(Message.time, Message.id).all()
    # `read`: whether the student has seen it (their own messages always are)
    return jsonify([dict(m.to_dict(), read=bool(m.read_by_user)) for m in rows])


@app.route('/api/messages', methods=['POST'])
@api_login_required
def api_send_message():
    user = current_user()
    try:
        text, image = read_message_payload()
    except ValueError as err:
        return api_error(str(err))
    message = Message(student_id=user.id, sender='user', text=text, image=image,
                      read_by_user=True, read_by_swafo=False)
    db.session.add(message)
    db.session.commit()
    return jsonify(message.to_dict()), 201


@app.route('/api/messages/read', methods=['POST'])
@api_login_required
def api_mark_read():
    user = current_user()
    Message.query.filter_by(student_id=user.id, read_by_user=False).update({"read_by_user": True})
    db.session.commit()
    return jsonify({"success": True})


@app.route('/api/admin/conversations', methods=['GET'])
@api_admin_required
def api_admin_conversations():
    student_counts = dict(db.session.query(Message.student_id, db.func.count()).group_by(Message.student_id).all())
    result = []
    for student_id, message_count in student_counts.items():
        student = db.session.get(User, student_id)
        if student is None or student.role != 'user':
            continue
        last = (Message.query.filter_by(student_id=student_id)
                .order_by(Message.time.desc(), Message.id.desc()).first())
        if last is None:
            continue
        unread = Message.query.filter_by(student_id=student_id, sender='user', read_by_swafo=False).count()
        result.append({
            "studentId": student.id,
            "name": student.full_name,
            "email": student.email,
            "schoolId": student.school_id,
            "unread": unread,
            "messageCount": message_count,
            "lastMessage": last.to_dict(),
        })
    result.sort(key=lambda r: r["lastMessage"]["time"], reverse=True)

    # ?with=<student id> also lists that student before either side has written, so SWAFO can
    # start the conversation (the Message button on the Reports page).
    with_id = request.args.get('with', type=int)
    if with_id and with_id not in student_counts:
        student = db.session.get(User, with_id)
        if student is not None and student.role == 'user':
            result.insert(0, {
                "studentId": student.id,
                "name": student.full_name,
                "email": student.email,
                "schoolId": student.school_id,
                "unread": 0,
                "messageCount": 0,
                "lastMessage": None,
            })
    return jsonify(result)


@app.route('/api/admin/conversations/<int:student_id>', methods=['GET'])
@api_admin_required
def api_admin_conversation(student_id):
    rows = Message.query.filter_by(student_id=student_id).order_by(Message.time, Message.id).all()
    return jsonify([m.to_dict() for m in rows])


@app.route('/api/admin/conversations/<int:student_id>', methods=['DELETE'])
@app.route('/api/admin/conversations/<int:student_id>/messages/<int:message_id>', methods=['DELETE'])
@admin_delete_transaction
def api_admin_delete_messages(student_id, uploads, payload, message_id=None):
    if User.query.filter_by(id=student_id, role='user').first() is None:
        return api_error('not_found', 404)
    messages = Message.query.filter_by(student_id=student_id)
    if message_id is not None:
        messages = messages.filter_by(id=message_id)
    deleted = messages.delete(synchronize_session=False)
    if not deleted:
        return api_error('not_found', 404)
    return jsonify(success=True, deletedCount=deleted)


@app.route('/api/admin/conversations/<int:student_id>', methods=['POST'])
@api_admin_required
def api_admin_reply(student_id):
    if db.session.get(User, student_id) is None:
        return api_error('not_found', 404)
    try:
        text, image = read_message_payload()
    except ValueError as err:
        return api_error(str(err))
    message = Message(student_id=student_id, sender='swafo', text=text, image=image,
                      read_by_user=False, read_by_swafo=True)
    db.session.add(message)
    db.session.commit()
    return jsonify(message.to_dict()), 201


@app.route('/api/admin/conversations/<int:student_id>/read', methods=['POST'])
@api_admin_required
def api_admin_mark_read(student_id):
    Message.query.filter_by(student_id=student_id, read_by_swafo=False).update({"read_by_swafo": True})
    db.session.commit()
    return jsonify({"success": True})


# ==========================================
# 11. SEARCH (Boyer-Moore, algorithms/boyer_moore.py)
# ==========================================
# Every search box sends its query here. Each scope searches the same text its page shows,
# as (record id, the texts searched, {field: text} for the fields the page marks).

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def date_label(day):
    """A date as the Browse cards show it: Nov 18, 2026."""
    return f"{MONTHS[day.month - 1]} {day.day}, {day.year}" if day else ""


def last_message_text(student_id, none_yet):
    """A conversation's latest message as the Messages lists show it."""
    last = (Message.query.filter_by(student_id=student_id)
            .order_by(Message.time.desc(), Message.id.desc()).first())
    return (last.text or "Sent a photo") if last else none_yet


def browse_records(_user):
    """Browse: found items still available, public fields only. Marks the name and place."""
    records = []
    for item in Item.query.filter(Item.report_type == 'found', Item.status != 'claimed'):
        place = algorithms.place_label(item.location, item.location_other)
        texts = (item.item_name, item.category, item.color, item.description, place, date_label(item.event_date))
        records.append((item.reference_code, texts, {"name": item.item_name, "place": place}))
    return records


def own_thread_records(user):
    """The student's Messages list: their one thread with SWAFO, by the office's name and the
    latest message. (The name is a browser setting; this is its default.)"""
    return [("swafo", ("SWAFO Office", last_message_text(user.id, "Ask SWAFO about a lost or found item.")), {})]


def report_records(_user):
    """Admin Reports: every report by name, ID, place and category. Marks the name, ID and place."""
    records = []
    for item in Item.query.all():
        place = algorithms.place_label(item.location, item.location_other)
        records.append((item.reference_code, (item.item_name, item.reference_code, place, item.category),
                        {"name": item.item_name, "id": item.reference_code, "place": place}))
    return records


def found_item_records(_user):
    """Admin Found Items: private fields too (brand, unique details, who turned it in, storage)."""
    return [(item.reference_code,
             (item.reference_code, item.item_name, item.category, item.color, item.description,
              algorithms.place_label(item.location, item.location_other), item.brand,
              item.identifying_details, item.turned_in_by, item.storage), {})
            for item in Item.query.filter_by(report_type='found')]


def claim_records(_user):
    """Admin Claims: the claim and item numbers, the item's name and the claimant."""
    return [(claim.reference,
             (claim.reference, claim.item.reference_code, claim.item.item_name,
              claim.claimant.full_name, claim.claimant.school_id, claim.claimant.email), {})
            for claim in Claim.query.all()]


def conversation_records(_user):
    """Admin Messages: each student's name, email, school ID and latest message."""
    return [(str(student.id),
             (student.full_name, student.email, student.school_id, last_message_text(student.id, "No messages yet")), {})
            for student in User.query.filter(User.role != 'admin')]


# scope -> (who may search it, its records)
SEARCH_SCOPES = {
    'browse': ('anyone', browse_records),
    'messages': ('user', own_thread_records),
    'reports': ('admin', report_records),
    'found-items': ('admin', found_item_records),
    'claims': ('admin', claim_records),
    'conversations': ('admin', conversation_records),
}


@app.route('/api/search', methods=['GET'])
def api_search():
    """?scope=...&q=...: the ids of the records whose text contains the query, found with
    Boyer-Moore (algorithms/boyer_moore.py), and where it is in the fields the page marks: {ids, hits: {id: {field:
    [[start, end], ...]}}}. Browse looks for every word of q, in any order; the other search
    boxes look for q as typed."""
    scope = request.args.get('scope', '')
    if scope not in SEARCH_SCOPES:
        return api_error('invalid_scope')
    who, records = SEARCH_SCOPES[scope]
    user = current_user()
    if who != 'anyone' and user is None:
        return api_error('login_required', 401)
    if who == 'admin' and user.role != 'admin':
        return api_error('forbidden', 403)

    query = clean(request.args.get('q'), 200).lower()
    patterns = query.split() if scope == 'browse' else [query]
    ids, hits = [], {}
    for record_id, texts, shown in records(user):
        text = " ".join(t or "" for t in texts).lower()
        if all(algorithms.contains(text, pattern) for pattern in patterns):
            ids.append(record_id)
            marks = {field: algorithms.hit_ranges(value, patterns) for field, value in shown.items()}
            marks = {field: ranges for field, ranges in marks.items() if ranges}
            if marks:
                hits[record_id] = marks
    return jsonify({"ids": ids, "hits": hits})


# ==========================================
# To start the server:
# ==========================================
def ensure_default_admin():
    """Creates one starter admin if the database has no admin yet. Does nothing otherwise."""
    if User.query.filter_by(role='admin').first():
        return
    email = os.environ.get('ADMIN_EMAIL', 'swafo.admin@dlsud.edu.ph').strip().lower()
    password = os.environ.get('ADMIN_PASSWORD', 'ChangeThisPassword123')
    db.session.add(User(
        full_name='SWAFO Admin',
        school_id='SWAFO-ADMIN',
        email=email,
        password_hash=generate_password_hash(password, method='scrypt'),
        role='admin',
    ))
    return email


def ensure_columns(connection):
    """db.create_all() never adds columns to tables that already exist, so add the newer ones here."""
    from sqlalchemy import inspect
    columns = {column['name'] for column in inspect(connection).get_columns('items')}
    if 'location_other' not in columns:
        connection.exec_driver_sql('ALTER TABLE items ADD COLUMN location_other VARCHAR(150)')
        print('Added items.location_other')
    claim_columns = {column['name'] for column in inspect(connection).get_columns('claims')}
    if 'lost_report_id' not in claim_columns:
        connection.exec_driver_sql('ALTER TABLE claims ADD COLUMN lost_report_id INTEGER REFERENCES items(id) ON DELETE SET NULL')
        connection.exec_driver_sql('CREATE INDEX IF NOT EXISTS ix_claims_lost_report_id ON claims (lost_report_id)')


def enable_foreign_keys(connection, _record):
    connection.execute('PRAGMA foreign_keys = ON')


def allocate_record_id(mapper, connection, record):
    # IDs are used by sessions and delete buttons, so a new row must not inherit an old ID.
    table_name = mapper.local_table.name
    allocate = record.id is None
    connection.exec_driver_sql(f'''
        UPDATE record_sequence
        SET last_id = MAX(last_id, ?, (SELECT COALESCE(MAX(id), 0) FROM {table_name})) + ?
        WHERE table_name = ?
    ''', (record.id or 0, int(allocate), table_name))
    if allocate:
        record.id = connection.exec_driver_sql(
            'SELECT last_id FROM record_sequence WHERE table_name = ?', (table_name,)
        ).scalar_one()


with app.app_context():
    event.listen(db.engine, 'connect', enable_foreign_keys)
    # Lock SQLite before checking the schema so simultaneous starts cannot race.
    connection = db.session.connection()
    connection.exec_driver_sql('BEGIN IMMEDIATE')
    db.metadata.create_all(connection)
    ensure_columns(connection)
    connection.exec_driver_sql('''
        INSERT INTO report_sequence (id, last_id)
        VALUES (1, (SELECT COALESCE(MAX(id), 0) FROM items))
        ON CONFLICT(id) DO UPDATE SET last_id = excluded.last_id
        WHERE report_sequence.last_id < excluded.last_id
    ''')
    for model in (User, Claim, Message):
        table_name = model.__tablename__
        connection.exec_driver_sql(f'''
            INSERT INTO record_sequence (table_name, last_id)
            VALUES (?, (SELECT COALESCE(MAX(id), 0) FROM {table_name}))
            ON CONFLICT(table_name) DO UPDATE SET last_id = excluded.last_id
            WHERE record_sequence.last_id < excluded.last_id
        ''', (table_name,))
        event.listen(model, 'before_insert', allocate_record_id)
    # Only direct local runs can create the starter admin.
    starter_email = ensure_default_admin() if __name__ == '__main__' else None
    db.session.commit()
    if starter_email:
        print(f'Created starter admin: {starter_email}')

if app.secret_key == 'dev-only-change-me' and __name__ != '__main__':
    print('WARNING: SECRET_KEY is not set. Anyone could forge a login. Set it before going public.')


if __name__ == '__main__':
    serve_locally(app, local_options.port)
