#!/usr/bin/env python3
"""Keep a release of the app so it can still be run later from the home screen.

    python3 tools/release.py <version> "<what changed>" [--from <git ref>]

Copies index.html and src/ (as they are now, or as they were at a git commit) into
versions/<version>/, points that copy's import map at the shared vendor/ folder, and adds the
release to versions/versions.json (which the home screen's "Run an older version" menu reads).
Set APP_VERSION in src/version.js to the new version when you make a release of the current code.
"""
import json, os, re, shutil, subprocess, sys, tarfile, io, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    args = sys.argv[1:]
    if len(args) < 1:
        print(__doc__); sys.exit(1)
    version = args[0]
    notes = args[1] if len(args) > 1 and not args[1].startswith('--') else ''
    ref = args[args.index('--from') + 1] if '--from' in args else None
    dest = os.path.join(ROOT, 'versions', version)
    if os.path.exists(dest):
        shutil.rmtree(dest)
    os.makedirs(dest)
    if ref:
        data = subprocess.run(['git', 'archive', '--format=tar', ref, 'index.html', 'src'], cwd=ROOT, check=True, capture_output=True).stdout
        with tarfile.open(fileobj=io.BytesIO(data)) as t:
            try: t.extractall(dest, filter='data')
            except TypeError: t.extractall(dest)
        date = subprocess.run(['git', 'log', '-1', '--format=%cs', ref], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    else:
        shutil.copy(os.path.join(ROOT, 'index.html'), dest)
        shutil.copytree(os.path.join(ROOT, 'src'), os.path.join(dest, 'src'))
        date = datetime.date.today().isoformat()
    # The copy shares the vendor libraries at the top of the site
    page = os.path.join(dest, 'index.html')
    html = open(page).read()
    html = html.replace('"./vendor/', '"../../vendor/')
    html = re.sub(r'<title>(.*?)</title>', lambda m: f'<title>{m.group(1)} ({version})</title>', html, count=1)
    open(page, 'w').write(html)
    listing = os.path.join(ROOT, 'versions', 'versions.json')
    entries = json.load(open(listing)) if os.path.exists(listing) else []
    entries = [e for e in entries if e['version'] != version]
    entries.append({'version': version, 'date': date, 'notes': notes})
    entries.sort(key=lambda e: [int(x) if x.isdigit() else x for x in re.split(r'[.\-]', e['version'])])
    json.dump(entries, open(listing, 'w'), indent=2)
    open(listing, 'a').write('\n')
    print(f'Kept version {version} ({date}) in versions/{version}/')

main()
