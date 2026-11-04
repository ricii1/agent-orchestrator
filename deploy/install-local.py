#!/usr/bin/python3
"""Install local Apache routing + linger. Does not restart the office daemon."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SITE = Path('/etc/apache2/sites-available/kantor.test.conf')
DEFAULT = Path('/etc/apache2/sites-available/000-default.conf')
HOSTS = Path('/etc/hosts')
MODULES = ('proxy', 'proxy_http', 'headers', 'rewrite')

def run(*args):
    subprocess.run(args, check=True)

def snapshot(path, backup, state):
    key = str(path)
    if key in state['files']:
        return
    if path.is_symlink():
        record = {'link': os.readlink(path)}
    elif path.exists():
        stat = path.stat()
        name = str(len(state['files']))
        shutil.copyfile(path, backup / name)
        record = {'copy': name, 'mode': stat.st_mode & 0o7777, 'uid': stat.st_uid, 'gid': stat.st_gid}
    else:
        record = {}
    state['files'][key] = record
    (backup / 'state.json').write_text(json.dumps(state, indent=2))

def restore(backup):
    state = json.loads((backup / 'state.json').read_text())
    for name, record in reversed(list(state['files'].items())):
        path = Path(name)
        if path.is_symlink():
            path.unlink()
        if 'link' in record:
            if path.exists():
                path.unlink()
            path.symlink_to(record['link'])
        elif 'copy' in record:
            # Write in place: /etc/hosts can be a bind-mounted file.
            path.write_bytes((backup / record['copy']).read_bytes())
            os.chmod(path, record['mode'])
            os.chown(path, record['uid'], record['gid'])
        elif path.exists():
            path.unlink()
    if not state['linger']:
        run('loginctl', 'disable-linger', 'ricii')
    run('apache2ctl', 'configtest')
    run('systemctl', 'reload', 'apache2')
    print('Restored system configuration from', backup)

def install():
    # Refuse to replace an unknown pre-existing site or conflicting host entry.
    if SITE.exists() or Path('/etc/apache2/sites-enabled/kantor.test.conf').exists():
        raise RuntimeError('kantor.test site already exists; inspect before reinstalling')
    for line in HOSTS.read_text().splitlines():
        fields = line.split('#', 1)[0].split()
        if 'kantor.test' in fields[1:]:
            raise RuntimeError('kantor.test already occurs in hosts; inspect before installing')
    original = DEFAULT.read_text()
    if original.count('<VirtualHost *:80>') != 1:
        raise RuntimeError('Unexpected default vhost; refusing automatic modification')
    run('apache2ctl', 'configtest')
    run('systemctl', 'is-active', '--quiet', 'apache2')
    backup = Path('/var/backups') / ('kantor-local-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(mode=0o700)
    state = {'linger': Path('/var/lib/systemd/linger/ricii').exists(), 'files': {}}
    paths = [HOSTS, DEFAULT, SITE, Path('/etc/apache2/sites-enabled/kantor.test.conf')]
    for module in MODULES:
        for suffix in ('load', 'conf'):
            if Path(f'/etc/apache2/mods-available/{module}.{suffix}').exists():
                paths.append(Path(f'/etc/apache2/mods-enabled/{module}.{suffix}'))
    for path in paths:
        snapshot(path, backup, state)
    print('Rollback backup:', backup, flush=True)
    try:
        # Preserve the existing default site for localhost and unknown hosts.
        DEFAULT.write_text(original.replace('<VirtualHost *:80>', '<VirtualHost *:80 127.0.0.1:80>'))
        SITE.write_bytes((ROOT / 'deploy/kantor.test.conf').read_bytes())
        os.chmod(SITE, 0o644)
        HOSTS.write_text(HOSTS.read_text().rstrip('\n') + '\n127.0.0.1 kantor.test # kantor-local\n')
        run('a2enmod', *MODULES)
        run('a2ensite', 'kantor.test')
        run('apache2ctl', 'configtest')
        run('loginctl', 'enable-linger', 'ricii')
        # Graceful Apache reload only; no restart of the office or other daemons.
        run('systemctl', 'reload', 'apache2')
        run('getent', 'hosts', 'kantor.test')
        run('loginctl', 'show-user', 'ricii', '-p', 'Linger')
        (ROOT / 'deploy/system-install-result.txt').write_text(f'Installed; rollback backup: {backup}\n')
        print('Installed successfully. No reboot performed.', flush=True)
    except BaseException:
        restore(backup)
        raise

if __name__ == '__main__':
    if os.geteuid() != 0:
        sys.exit('Administrator authentication required; run via pkexec or sudo.')
    with open('/run/lock/kantor-local.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if len(sys.argv) == 3 and sys.argv[1] == '--rollback':
            backup = Path(sys.argv[2]).resolve()
            if backup.parent != Path('/var/backups') or not re.fullmatch(r'kantor-local-\d{8}-\d{6}', backup.name):
                sys.exit('Invalid backup path')
            restore(backup)
        elif len(sys.argv) == 1:
            install()
        else:
            sys.exit('Usage: install-local.py [--rollback /var/backups/kantor-local-TIMESTAMP]')
