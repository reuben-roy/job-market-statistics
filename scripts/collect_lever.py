#!/usr/bin/env python3
"""Collect public Lever boards into a statistics-only SQLite store; never publish to app feed."""
import fcntl
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get('STATS_DATA_DIR', Path.home() / '.config' / 'job-statistics'))
BOARDS = (
    'employ', 'erg', 'drivetrain', 'egen', 'bolster', 'fehrandpeers', 'jumpcloud',
    'mechanicalorchard', 'saviynt', 'paralleldomain', 'azul', 'acceldata', 'pivotal',
    'forbrightbank', 'tali-ai',
)
PAGE_SIZE = 100
MAX_JOBS = 10000
USER_AGENT = 'JobApplicatorStatistics/1.0 (+https://jobs.explosion.fun)'


def read_board(board):
    jobs = []
    for skip in range(0, MAX_JOBS + 1, PAGE_SIZE):
        req = urllib.request.Request(f'https://api.lever.co/v0/postings/{board}?mode=json&skip={skip}&limit={PAGE_SIZE}', headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read(20_000_001)
            if len(raw) > 20_000_000: raise ValueError('response exceeds size limit')
        page = json.loads(raw)
        if not isinstance(page, list) or any(not isinstance(job, dict) for job in page): raise ValueError('invalid board response')
        jobs.extend(page)
        if len(jobs) > MAX_JOBS: raise ValueError('board exceeds job limit')
        if len(page) < PAGE_SIZE: break
        time.sleep(1)
    ids = [j.get('id') for j in jobs]
    if any(not isinstance(i, str) or not re.fullmatch(r'[0-9a-fA-F-]{36}', i) for i in ids) or len(set(ids)) != len(ids): raise ValueError('invalid or duplicate IDs')
    return jobs


def normalize(job):
    title = job.get('text')
    if not isinstance(title, str) or not title.strip(): raise ValueError('missing title')
    sections = job.get('lists') or []
    if not isinstance(sections, list): raise ValueError('invalid section list')
    parts = []
    for section in sections:
        if not isinstance(section, dict): raise ValueError('invalid section')
        heading, body = section.get('text'), section.get('content')
        if isinstance(heading, str) and isinstance(body, str): parts.append('<h2>' + html.escape(heading) + '</h2>' + body)
    body = job.get('descriptionBody')
    if isinstance(body, str): parts.insert(0, '<h2>Job description</h2>' + body)
    # Lever createdAt is creation time, not a reliable publication date.
    published = None
    country = job.get('country'); country = country if isinstance(country, str) and re.fullmatch('[A-Z]{2}', country) else None
    result = {'title': title, 'raw_description': '\n'.join(parts), 'country': country, 'published_at': published}
    salary = job.get('salaryRange')
    if isinstance(salary, dict) and salary.get('currency') == 'USD' and salary.get('interval') == 'per-year-salary':
        low, high = salary.get('min'), salary.get('max')
        if type(low) in (int, float) and type(high) in (int, float) and 15000 <= low <= high <= 3000000:
            result.update(salary_min=int(low), salary_max=int(high), currency='USD')
    return result


def apply_board(db, board, jobs):
    # Refuse empty or sudden collapses; a failed/partial response must never close jobs.
    previous = db.execute('select count(*) from postings where source=? and status="open"', (board,)).fetchone()[0]
    if not jobs or (previous >= 10 and len(jobs) < previous / 2): raise ValueError('empty or collapsed board held')
    normalized = [(job['id'].lower(), json.dumps(normalize(job), separators=(',', ':'))) for job in jobs]
    with db:
        db.execute('update postings set missing=missing+1 where source=? and status="open"', (board,))
        for job_id, payload in normalized:
            db.execute('''insert into postings(id,source,payload,status,missing) values(?,?,?,'open',0)
                on conflict(id) do update set payload=excluded.payload,status='open',missing=0''', (f'lever:{board}:{job_id}', board, payload))
        db.execute('update postings set status="closed" where source=? and status="open" and missing>=2', (board,))



def initialize_health(db):
    db.execute("""create table if not exists statistics_source_health (
        source text primary key, last_success_at integer, last_error text
    )""")
    db.commit()


def collect_board(db, board, fetch=None, clock=None):
    """A failing board retains its records and does not stop other sources."""
    fetch = fetch or read_board
    clock = clock or time.time
    try:
        jobs = fetch(board)
        apply_board(db, board, jobs)
    except Exception as error:
        with db:
            db.execute("""insert into statistics_source_health(source,last_success_at,last_error)
                values(?,NULL,?) on conflict(source) do update set last_error=excluded.last_error""",
                (board, f'{type(error).__name__}: {error}'[:500]))
        print(f'lever:{board}: failed: {error}', file=sys.stderr)
        return False
    with db:
        db.execute("""insert into statistics_source_health(source,last_success_at,last_error)
            values(?,?,NULL) on conflict(source) do update set
            last_success_at=excluded.last_success_at,last_error=NULL""", (board, int(clock())))
    print(f'lever:{board}: {len(jobs)} postings')
    return True

def main():
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.umask(0o077)
    path = ROOT / 'statistics-only.sqlite3'
    with open(str(path) + '.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        db = sqlite3.connect(path)
        db.execute('create table if not exists postings(id text primary key, source text not null, payload text not null, status text not null, missing integer not null)')
        initialize_health(db)
        failures = []
        for board in BOARDS:
            if not collect_board(db, board): failures.append(board)
            time.sleep(1)
        db.close()
        if failures: print(f'{len(failures)} Lever boards failed; retaining previous data', file=sys.stderr)

if __name__ == '__main__': main()
