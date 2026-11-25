"""Prepare a Python environment for a direct run of app.py."""

import argparse
from contextlib import closing
from importlib import import_module
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
from tempfile import NamedTemporaryFile


BACKEND_DIR = Path(__file__).resolve().parent
ENV_DIR = BACKEND_DIR / '.venv'
REQUIREMENTS = BACKEND_DIR / 'requirements.txt'


def dependencies_available():
    try:
        for module in ('flask', 'flask_sqlalchemy', 'sqlalchemy', 'werkzeug.security'):
            import_module(module)
    except ImportError:
        return False
    return True


def command_succeeds(command):
    try:
        result = subprocess.run(
            command, cwd=BACKEND_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        return False
    return result.returncode == 0


def run_in_local_environment():
    python = ENV_DIR / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    dependency_check = [
        python, '-B', '-c',
        'from local_startup import dependencies_available; '
        'raise SystemExit(0 if dependencies_available() else 1)',
    ]

    try:
        ENV_DIR.mkdir(exist_ok=True)
        # The OS releases the SQLite lock even if a setup process is interrupted.
        with closing(sqlite3.connect(ENV_DIR / '.setup.sqlite', timeout=120)) as lock:
            lock.execute('BEGIN EXCLUSIVE')
            if not command_succeeds(dependency_check):
                print('Setting up FindIt dependencies. First-time setup needs internet access.', flush=True)
                if not command_succeeds([python, '-m', 'pip', '--version']):
                    from venv import EnvBuilder

                    EnvBuilder(with_pip=True).create(ENV_DIR)
                subprocess.run(
                    [python, '-m', 'pip', '--disable-pip-version-check', 'install', '-r', REQUIREMENTS],
                    cwd=BACKEND_DIR,
                    check=True,
                )
                if not command_succeeds(dependency_check):
                    raise RuntimeError('The installed Python packages could not be imported.')
    except (ImportError, OSError, RuntimeError, sqlite3.Error, subprocess.CalledProcessError) as error:
        raise SystemExit(
            f'FindIt could not set up its Python dependencies ({error}). '
            'Use Python with venv and pip support, a writable project folder, and an internet connection.'
        ) from error

    raise SystemExit(subprocess.call([python, '-B', BACKEND_DIR / 'app.py', *sys.argv[1:]]))


def check_project_files(root):
    required_files = ('backend/requirements.txt', 'static/js/data/locations.js', 'templates/index.html')
    missing = [relative for relative in required_files if not (root / relative).is_file()]
    if missing:
        raise SystemExit(
            f'FindIt is missing {", ".join(missing)}. '
            'Extract the whole project and keep backend, templates, and static together.'
        )


def check_runtime_storage(root):
    instance_dir = root / 'instance'
    for directory in (instance_dir, root / 'static' / 'uploads'):
        try:
            directory.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(dir=directory, prefix='.findit-startup-') as probe:
                probe.write(b'FindIt')
                probe.flush()
        except OSError as error:
            raise SystemExit(
                f'FindIt cannot write to {directory} ({error}). '
                'Use a writable project folder and check that the drive has free space.'
            ) from error

    database = instance_dir / 'database.db'
    try:
        with database.open('r+b'):
            pass
    except FileNotFoundError:
        return
    except OSError as error:
        raise SystemExit(
            f'FindIt cannot open {database} for writing ({error}). '
            'Check that the database is writable and close other programs using it.'
        ) from error


def prepare_local_run():
    parser = argparse.ArgumentParser(description='Start FindIt on this computer.')
    parser.add_argument('--port', type=int, help='Use a specific local port instead of trying 5000.')
    options = parser.parse_args()
    if options.port is not None and not 0 <= options.port <= 65535:
        parser.error('--port must be between 0 and 65535')

    if sys.version_info < (3, 9):
        raise SystemExit('FindIt needs Python 3.9 or later. Install a current Python 3 release.')

    root = BACKEND_DIR.parent
    check_project_files(root)
    check_runtime_storage(root)

    try:
        if not dependencies_available():
            run_in_local_environment()
    except KeyboardInterrupt:
        raise SystemExit(130) from None
    return options


def serve_locally(app, port):
    from werkzeug.serving import ThreadedWSGIServer

    class LocalServer(ThreadedWSGIServer):
        allow_reuse_address = os.name != 'nt'

        def server_bind(self):
            if os.name == 'nt':
                # Windows SO_REUSEADDR can let two servers claim the same port.
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()

    try:
        server = LocalServer('127.0.0.1', 5000 if port is None else port, app)
    except SystemExit as error:
        if port is not None or error.code != 1:
            raise
        print('FindIt could not use port 5000. Trying a free local port.', flush=True)
        server = LocalServer('127.0.0.1', 0, app)

    with server:
        server.log_startup()
        print('Press Ctrl+C to stop FindIt.', flush=True)
        server.serve_forever()
