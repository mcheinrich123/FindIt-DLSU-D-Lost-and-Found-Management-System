"""Email for FindIt: verification links, password resets and student notifications.

Email is optional. It turns on when these environment variables are set (see DEPLOY.md):

    SMTP_HOST       the mail server, e.g. smtp.gmail.com
    SMTP_FROM       the sender address, e.g. swafo_helpdesk@dlsud.edu.ph
    SMTP_PORT       587 by default
    SMTP_SECURITY   starttls (default), ssl, or none
    SMTP_USER       login for the mail server, if it needs one
    SMTP_PASSWORD

Without them FindIt runs as before: accounts don't need email verification, password resets go
through SWAFO, and notifications stay inside FindIt.
"""

import logging
import os
import smtplib
import ssl
import threading
from email.message import EmailMessage

log = logging.getLogger(__name__)


def configured():
    return bool(os.environ.get('SMTP_HOST', '').strip() and os.environ.get('SMTP_FROM', '').strip())


def _deliver(to, subject, body):
    host = os.environ['SMTP_HOST'].strip()
    security = os.environ.get('SMTP_SECURITY', 'starttls').strip().lower()
    port = int(os.environ.get('SMTP_PORT') or (465 if security == 'ssl' else 587))
    message = EmailMessage()
    message['From'] = os.environ['SMTP_FROM'].strip()
    message['To'] = to
    message['Subject'] = subject
    message.set_content(body)

    context = ssl.create_default_context()
    if security == 'ssl':
        server = smtplib.SMTP_SSL(host, port, context=context, timeout=20)
    else:
        server = smtplib.SMTP(host, port, timeout=20)
    with server:
        if security == 'starttls':
            server.starttls(context=context)
        user = os.environ.get('SMTP_USER', '').strip()
        if user:
            server.login(user, os.environ.get('SMTP_PASSWORD', ''))
        server.send_message(message)


def _deliver_logged(to, subject, body):
    try:
        _deliver(to, subject, body)
    except (OSError, smtplib.SMTPException, ValueError):
        log.exception('Could not send email "%s"', subject)


def send(to, subject, body, *, wait=False):
    """Sends one plain-text email. Returns False when email isn't set up.

    By default it sends in the background so a slow mail server never holds up a page.
    """
    if not configured() or not to:
        return False
    if wait:
        _deliver(to, subject, body)
    else:
        threading.Thread(target=_deliver_logged, args=(to, subject, body), daemon=True).start()
    return True
