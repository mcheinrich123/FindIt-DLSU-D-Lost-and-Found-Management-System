"""Set a new password for an existing account (admin or student), from the console.

    EMAIL=swafo.admin@dlsud.edu.ph NEW_PASSWORD='...' python reset_password.py
"""
import os
from app import app, db, User
from werkzeug.security import generate_password_hash

email = os.environ.get('EMAIL', '').strip().lower()
password = os.environ.get('NEW_PASSWORD')

if not email:
    raise SystemExit('Set EMAIL to the account\'s email address first.')
if not password or len(password) < 8:
    raise SystemExit('Set NEW_PASSWORD (at least 8 characters) first.')

with app.app_context():
    user = User.query.filter_by(email=email).first()
    if not user:
        raise SystemExit(f'No account with {email}.')
    user.password_hash = generate_password_hash(password, method='scrypt')
    db.session.commit()
    print(f'Password updated for {email} ({user.role})')
