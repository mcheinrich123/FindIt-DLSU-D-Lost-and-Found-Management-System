import os
from app import app, db, User
from werkzeug.security import generate_password_hash

admin_name = os.environ.get('ADMIN_NAME', '').strip()
admin_school_id = os.environ.get('ADMIN_SCHOOL_ID', '').strip()
admin_email = os.environ.get('ADMIN_EMAIL', '').strip().lower()
password = os.environ.get('ADMIN_PASSWORD')

if not admin_name:
    raise SystemExit('Set ADMIN_NAME first.')
if not admin_school_id:
    raise SystemExit('Set ADMIN_SCHOOL_ID first.')
if not admin_email or '@' not in admin_email:
    raise SystemExit('Set ADMIN_EMAIL to a valid email address first.')
if not password or len(password) < 8:
    raise SystemExit('Set ADMIN_PASSWORD (at least 8 characters) first.')

with app.app_context():
    db.create_all()
    if User.query.filter_by(email=admin_email).first():
        raise SystemExit(f'An account with {admin_email} already exists.')
    if User.query.filter_by(school_id=admin_school_id).first():
        raise SystemExit(f'An account with school ID {admin_school_id} already exists.')

    db.session.add(User(
        full_name=admin_name,
        school_id=admin_school_id,
        email=admin_email,
        password_hash=generate_password_hash(password, method='scrypt'),
        role='admin',
    ))
    db.session.commit()
    print('Admin created:', admin_email)