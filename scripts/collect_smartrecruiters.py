#!/usr/bin/env python3
"""Collect public SmartRecruiters boards into a dedicated statistics-only store."""
import datetime
import fcntl
import hashlib
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get('STATS_DATA_DIR', Path.home() / '.config' / 'job-statistics'))
DB = ROOT / 'smartrecruiters-statistics.sqlite3'
BOARDS = ('Expeditors', 'Wabtec', 'Intuitive', 'WesternDigital', 'AristaNetworks')
# Employer public boards; statistics only, never sent to the Job Applicator feed.
PAGE_SIZE = 100
MAX_JOBS = 30000
MAX_BYTES = 8_000_000
CACHE_SECONDS = 7 * 86400
USER_AGENT = 'JobApplicatorStatistics/1.0 (+https://jobs.explosion.fun)'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None

OPENER = urllib.request.build_opener(NoRedirect())


def request_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
    for attempt in range(3):
        delay = 2 ** (attempt + 1)
        try:
            with OPENER.open(request, timeout=35) as response:
                data = response.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES: raise ValueError('response too large')
                return json.loads(data)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2: raise
            retry_after = error.headers.get('Retry-After', '')
            if retry_after.isdigit(): delay = max(delay, min(int(retry_after), 120))
        except (TimeoutError, urllib.error.URLError):
            if attempt == 2: raise
        time.sleep(delay)


def initialize(db):
    db.execute('create table if not exists postings(id text primary key, source text not null, payload text not null, status text not null, missing integer not null)')
    db.execute('create table if not exists statistics_source_health(source text primary key, last_success_at integer, last_error text)')
    db.execute('create table if not exists details_cache(id text primary key, source text not null, signature text not null, checked_at integer not null, payload text not null)')


def base_url(board):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', board): raise ValueError('invalid board')
    return f'https://api.smartrecruiters.com/v1/companies/{board}/postings'


def list_board(board, fetch=request_json, pause=time.sleep):
    base = base_url(board); jobs = []; seen = set(); expected = None
    for offset in range(0, MAX_JOBS + 1, PAGE_SIZE):
        if offset: pause(1)
        page = fetch(f'{base}?limit={PAGE_SIZE}&offset={offset}&destination=PUBLIC')
        if not isinstance(page, dict) or type(page.get('totalFound')) is not int or not isinstance(page.get('content'), list) or page.get('offset') != offset:
            raise ValueError('invalid list response')
        total = page['totalFound']; rows = page['content']
        if expected is None:
            expected = total
            if total <= 0 or total > MAX_JOBS: raise ValueError('empty or oversized board held')
        if total != expected: raise ValueError('changing total during pagination')
        if len(rows) != min(PAGE_SIZE, expected-offset): raise ValueError('incomplete page')
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not re.fullmatch(r'\d{1,30}', row['id']) or row['id'] in seen:
                raise ValueError('invalid or duplicate posting id')
            if row.get('visibility', 'PUBLIC') != 'PUBLIC': raise ValueError('non-public posting in public list')
            seen.add(row['id']); jobs.append(row)
        if len(jobs) == expected: break
    if len(jobs) != expected: raise ValueError('incomplete list')
    return jobs


def normalize(detail, expected_id):
    if not isinstance(detail,dict) or detail.get('id') != expected_id or detail.get('active') is False or detail.get('visibility','PUBLIC') != 'PUBLIC': raise ValueError('invalid posting detail')
    title = detail.get('name'); ad=detail.get('jobAd'); sections=ad.get('sections') if isinstance(ad,dict) else None
    if not isinstance(title,str) or not title.strip() or not isinstance(sections,dict): raise ValueError('missing title or sections')
    body=[]
    # Use the API's typed fields instead of company description and additional information.
    for field,heading in (('jobDescription','Job description'),('qualifications','Qualifications')):
        section=sections.get(field)
        if isinstance(section,dict) and isinstance(section.get('text'),str):
            body.append('<h2>'+html.escape(heading)+'</h2>'+section['text'])
    if not body: raise ValueError('no role description or qualifications')
    loc=detail.get('location'); country=loc.get('country') if isinstance(loc,dict) else None
    country=country.upper() if isinstance(country,str) and re.fullmatch(r'[A-Za-z]{2}',country) else None
    published=detail.get('releasedDate')
    if isinstance(published,str):
        try: datetime.datetime.fromisoformat(published.replace('Z','+00:00'))
        except ValueError: published=None
    else: published=None
    return {'title':title,'raw_description':'\n'.join(body),'country':country,'published_at':published}


def fetch_board(board, cache, fetch=request_json, pause=time.sleep, now=None):
    now = int(time.time()) if now is None else now
    rows = list_board(board, fetch=fetch, pause=pause)
    output=[]; updates=[]
    for index,row in enumerate(rows,1):
        identity=row['id']; signature=hashlib.sha256(json.dumps(row,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        cached=cache.get(identity)
        if cached and cached[0] == signature and 0 <= now-cached[1] < CACHE_SECONDS:
            payload=json.loads(cached[2])
        else:
            if index == 1 or index % 100 == 0: print(f'SmartRecruiters {board}: detail {index}/{len(rows)}',flush=True)
            pause(1)
            detail=fetch(base_url(board)+'/'+identity)
            payload=normalize(detail,identity)
            updates.append((identity,signature,now,json.dumps(payload,separators=(',',':'))))
        payload['canonical_id'] = f'smartrecruiters:{board.casefold()}:{identity}'
        output.append((identity,payload))
    return output,updates


def apply_board(db, board, jobs, updates, now=None):
    now=int(time.time()) if now is None else now
    source='smartrecruiters:'+board
    previous=db.execute('select count(*) from postings where source=? and status="open"',(source,)).fetchone()[0]
    if not jobs or (previous>=10 and len(jobs)<previous/2): raise ValueError('empty or collapsed board held')
    ids=[identity for identity,_ in jobs]
    if len(ids)!=len(set(ids)): raise ValueError('duplicate posting id')
    with db:
        db.execute('update postings set missing=missing+1 where source=? and status="open"',(source,))
        for identity,payload in jobs:
            db.execute('''insert into postings(id,source,payload,status,missing) values(?,?,?,'open',0)
                on conflict(id) do update set payload=excluded.payload,status='open',missing=0''', (source+':'+identity,source,json.dumps(payload,separators=(',',':'))))
        db.execute('update postings set status="closed" where source=? and status="open" and missing>=2',(source,))
        for identity,signature,checked,payload in updates:
            db.execute('''insert into details_cache(id,source,signature,checked_at,payload) values(?,?,?,?,?)
                on conflict(id) do update set signature=excluded.signature,checked_at=excluded.checked_at,payload=excluded.payload''', (source+':'+identity,source,signature,checked,payload))
        db.execute('''insert into statistics_source_health(source,last_success_at,last_error) values(?,?,NULL)
            on conflict(source) do update set last_success_at=excluded.last_success_at,last_error=NULL''',(source,now))


def cached_details(db,board):
    source='smartrecruiters:'+board
    return {row[0][len(source)+1:]:tuple(row[1:]) for row in db.execute('select id,signature,checked_at,payload from details_cache where source=?',(source,))}


def main():
    os.umask(0o077);ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
    with open(str(DB)+'.poll.lock','a') as poll:
        fcntl.flock(poll,fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Unknown until each configured source has completed a poll; prevents a partial initial
        # collection from presenting the whole source set as fresh.
        with open(str(DB)+'.lock','a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            with sqlite3.connect(DB) as db:
                initialize(db)
                db.executemany('insert or ignore into statistics_source_health(source,last_error) values(?,?)',
                               [('smartrecruiters:'+board,'Initial collection pending') for board in BOARDS])
        failures=[]
        for board in BOARDS:
            source='smartrecruiters:'+board
            try:
                with open(str(DB)+'.lock','a') as lock:
                    fcntl.flock(lock,fcntl.LOCK_EX)
                    with sqlite3.connect(DB) as db:
                        initialize(db);cache=cached_details(db,board)
                jobs,updates=fetch_board(board,cache)
                with open(str(DB)+'.lock','a') as lock:
                    fcntl.flock(lock,fcntl.LOCK_EX)
                    with sqlite3.connect(DB) as db:
                        initialize(db);apply_board(db,board,jobs,updates)
                print(f'SmartRecruiters {board}: {len(jobs)} postings',flush=True)
            except Exception as error:
                failures.append(board);print(f'SmartRecruiters {board}: failed: {error}',file=sys.stderr,flush=True)
                with open(str(DB)+'.lock','a') as lock:
                    fcntl.flock(lock,fcntl.LOCK_EX)
                    with sqlite3.connect(DB) as db:
                        initialize(db)
                        db.execute('''insert into statistics_source_health(source,last_error) values(?,?)
                          on conflict(source) do update set last_error=excluded.last_error''',(source,str(error)[:500]))
        if failures: print(f'{len(failures)} boards failed; previous records retained',file=sys.stderr)

if __name__=='__main__':main()
