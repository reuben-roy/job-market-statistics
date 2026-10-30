#!/usr/bin/env python3
"""Collect public Workday boards to a dedicated statistics-only SQLite database.

Run independently of the dashboard refresh: network work holds a poll lock, not
SQLite's snapshot lock. A board is applied atomically only after complete listing
and detail retrieval. No records are sent to the Job Applicator feed.
"""
import fcntl
import hashlib
from concurrent.futures import ThreadPoolExecutor
import threading
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
DB = ROOT / 'workday-statistics.sqlite3'
USER_AGENT = 'JobApplicatorStatistics/1.0 (+https://jobs.explosion.fun)'
# (hostname, tenant, site) from employer public job sites.
BOARDS = [
    ('mckesson.wd3.myworkdayjobs.com', 'mckesson', 'External_Careers'),
    ('ingredion.wd1.myworkdayjobs.com', 'ingredion', 'IngredionCareers'),
    ('visa.wd5.myworkdayjobs.com', 'visa', 'Visa'),
    ('allstate.wd5.myworkdayjobs.com', 'allstate', 'Allstate_Careers'),
    ('stryker.wd1.myworkdayjobs.com', 'stryker', 'StrykerCareers'),
    ('kyndryl.wd5.myworkdayjobs.com', 'kyndryl', 'KyndrylProfessionalCareers'),
    ('fis.wd5.myworkdayjobs.com', 'fis', 'SearchJobs'),
    ('mastercard.wd1.myworkdayjobs.com', 'mastercard', 'CorporateCareers'),
    ('ferguson.wd1.myworkdayjobs.com', 'ferguson', 'Ferguson_Experienced'),
    ('gilead.wd1.myworkdayjobs.com', 'gilead', 'gileadcareers'),
    ('motorolasolutions.wd5.myworkdayjobs.com', 'motorolasolutions', 'Careers'),
    ('rockwellautomation.wd1.myworkdayjobs.com', 'rockwellautomation', 'External_Rockwell_Automation'),
    ('kla.wd1.myworkdayjobs.com', 'kla', 'Search'),
    ('nasdaq.wd1.myworkdayjobs.com', 'nasdaq', 'Global_External_Site'),
    ('biibhr.wd3.myworkdayjobs.com', 'biibhr', 'external'),
    ('capitalone.wd12.myworkdayjobs.com', 'capitalone', 'Capital_One'),
    ('target.wd5.myworkdayjobs.com', 'target', 'targetcareers'),
    ('jabil.wd5.myworkdayjobs.com', 'jabil', 'Jabil_Careers'),
    ('leidos.wd5.myworkdayjobs.com', 'leidos', 'External'),
    ('gevernova.wd5.myworkdayjobs.com', 'gevernova', 'Vernova_ExternalSite'),
    ('bah.wd1.myworkdayjobs.com', 'bah', 'BAH_Jobs'),
    ('amgen.wd1.myworkdayjobs.com', 'amgen', 'Careers'),
    ('usbank.wd1.myworkdayjobs.com', 'usbank', 'US_Bank_Careers'),
    ('dukeenergy.wd1.myworkdayjobs.com', 'dukeenergy', 'Search'),
    ('ur.wd1.myworkdayjobs.com', 'ur', 'URcareers'),
    ('travelers.wd5.myworkdayjobs.com', 'travelers', 'External'),
    ('expedia.wd108.myworkdayjobs.com', 'expedia', 'search'),
    ('statestreet.wd1.myworkdayjobs.com', 'statestreet', 'Global'),
    ('xcelenergy.wd1.myworkdayjobs.com', 'xcelenergy', 'External'),
    ('spgi.wd5.myworkdayjobs.com', 'spgi', 'SPGI_Careers'),
    ('workday.wd5.myworkdayjobs.com', 'workday', 'Workday'),
    ('carmax.wd1.myworkdayjobs.com', 'carmax', 'External'),
    ('fifththird.wd5.myworkdayjobs.com', 'fifththird', '53careers'),
    ('alcoa.wd5.myworkdayjobs.com', 'alcoa', 'Careers'),
    ('viatris.wd5.myworkdayjobs.com', 'viatris', 'External'),
    ('unum.wd1.myworkdayjobs.com', 'unum', 'External'),
    ('keybank.wd5.myworkdayjobs.com', 'keybank', 'External_Career_Site'),
    ('mtb.wd5.myworkdayjobs.com', 'mtb', 'MTB'),
    ('aig.wd1.myworkdayjobs.com', 'aig', 'aig'),
    ('bristolmyerssquibb.wd5.myworkdayjobs.com', 'bristolmyerssquibb', 'BMS'),
    ('landolakes.wd1.myworkdayjobs.com', 'landolakes', 'LandOLakes'),
    ('pultegroup.wd1.myworkdayjobs.com', 'pultegroup', 'PGI'),
    ('crownholdings.wd501.myworkdayjobs.com', 'crownholdings', 'CrownHoldings'),
]
# Capped boards use facet partitioning or an explicitly partial capped listing.

PAGE = 20
# Public CXS endpoints cap result sets at 2,000; don't silently treat that as complete.
CXS_CAP = 2000
MAX_BYTES = 8_000_000
COUNTRIES = {'united states of america': 'US', 'united states': 'US', 'canada': 'CA', 'united kingdom': 'GB', 'india': 'IN', 'australia': 'AU', 'germany': 'DE', 'france': 'FR', 'mexico': 'MX', 'brazil': 'BR'}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None



def request_json(url, data=None):
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json'}
    if data is not None: headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(), headers=headers)
    for attempt in range(3):
        retry_delay = 2 ** (attempt + 1)
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=35) as response:
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES: raise ValueError('response too large')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2: raise
            retry_after = error.headers.get('Retry-After', '')
            if retry_after.isdigit(): retry_delay = max(retry_delay, min(int(retry_after), 120))
        except (TimeoutError, urllib.error.URLError):
            if attempt == 2: raise
        time.sleep(retry_delay)


def base_url(board):
    host, tenant, site = board
    if not re.fullmatch(r'[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com', host): raise ValueError('invalid host')
    if host.split('.')[0] != tenant or not re.fullmatch(r'[A-Za-z0-9_-]+', site): raise ValueError('invalid tenant or site')
    return f'https://{host}/wday/cxs/{tenant}/{site}'


def list_board(board, fetch=request_json, pause=time.sleep):
    """Partition a known-size board by disjoint facets; fail closed on ambiguity."""
    base = base_url(board)
    requests = 0
    incomplete = False
    global_paths = {}
    def page(facets, offset=0):
        nonlocal requests
        if requests: pause(1)
        requests += 1
        result = fetch(base + '/jobs', {'appliedFacets': facets, 'limit': PAGE, 'offset': offset, 'searchText': ''})
        if not isinstance(result, dict) or type(result.get('total')) is not int or not isinstance(result.get('jobPostings'), list): raise ValueError('invalid listing response')
        return result
    root = page({})
    # Exactly 2,000 is ambiguous: a validated first page-set is partial, never complete.
    if root['total'] <= 0: raise ValueError('empty board held')
    expected_total = root['total']
    if expected_total > 20000: raise ValueError('board exceeds maximum size')
    def walk(facets, first, expected, depth=0):
        nonlocal incomplete
        if depth > 8: raise ValueError('facet nesting limit reached')
        actual = first['total']
        if actual != expected and not (actual == CXS_CAP and expected >= CXS_CAP): raise ValueError('partition count mismatch')
        if expected >= CXS_CAP:
            options = []
            for facet in first.get('facets', []):
                key = facet.get('facetParameter') if isinstance(facet, dict) else None
                values = facet.get('values') if isinstance(facet, dict) else None
                if not isinstance(key, str) or key in facets or not isinstance(values, list): continue
                if len(values) < 2 or len(values) > 1000: continue
                if any(not isinstance(v, dict) or not isinstance(v.get('id'), str) or type(v.get('count')) is not int or v['count'] <= 0 for v in values): continue
                if len({v['id'] for v in values}) != len(values) or sum(v['count'] for v in values) != expected: continue
                if max(v['count'] for v in values) >= expected: continue
                options.append((max(v['count'] for v in values), len(values), key, values))
            if not options: raise ValueError('no exhaustive disjoint facet partition')
            _, _, key, values = min(options, key=lambda item: (item[0], item[1]))
            for value in values:
                child = {**facets, key: [value['id']]}
                walk(child, page(child), value['count'], depth + 1)
            return
        for offset in range(0, expected, PAGE):
            result = first if offset == 0 else page(facets, offset)
            if result['total'] not in (0, expected): raise ValueError(f"changing partition count: expected {expected}, got {result['total']} at offset {offset}")
            rows = result['jobPostings']
            if len(rows) != min(PAGE, expected - offset): raise ValueError('incomplete page')
            for row in rows:
                if not isinstance(row, dict): raise ValueError('invalid listing')
                path = row.get('externalPath')
                if path is None:
                    incomplete = True
                    continue
                if not isinstance(path, str) or not re.fullmatch(r'/job/[A-Za-z0-9_./%~-]+', path) or '..' in path: raise ValueError('invalid listing path')
                if path in global_paths: raise ValueError('overlapping or duplicate facet results')
                material = {key: row.get(key) for key in ('title', 'locationsText', 'bulletFields')}
                signature = hashlib.sha256(json.dumps(material, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                global_paths[path] = signature
    try:
        if expected_total == CXS_CAP: raise ValueError('ambiguous capped total')
        walk({}, root, expected_total)
        if page({})['total'] != expected_total: raise ValueError('board changed during collection')
    except ValueError as error:
        # A changing or unpartitionable large board can still contribute its first
        # complete page-set, but cannot cause closures or advance freshness.
        if expected_total < CXS_CAP: raise
        print(f'Workday board {board[0]}: partial capped listing ({error})', file=sys.stderr, flush=True)
        global_paths.clear()
        incomplete = True
        for offset in range(0, CXS_CAP, PAGE):
            result = root if offset == 0 else page({}, offset)
            rows = result['jobPostings']
            if len(rows) != PAGE: raise ValueError('incomplete capped page-set')
            for row in rows:
                path = row.get('externalPath') if isinstance(row, dict) else None
                if not isinstance(path, str) or not re.fullmatch(r'/job/[A-Za-z0-9_./%~-]+', path) or '..' in path or path in global_paths: raise ValueError('invalid or duplicate capped listing')
                material = {key: row.get(key) for key in ('title', 'locationsText', 'bulletFields')}
                global_paths[path] = hashlib.sha256(json.dumps(material, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        print(f'Workday board {board[0]}: {len(global_paths)} partial listings (closures held)', file=sys.stderr, flush=True)
        expected_total = len(global_paths)
    if len(global_paths) > expected_total: raise ValueError('partition count exceeds total')
    missing = expected_total - len(global_paths)
    if missing * 20 > expected_total: raise ValueError('too many listings without paths')
    if not global_paths: raise ValueError('no usable jobs')
    return sorted(global_paths.items()), expected_total, incomplete


def fetch_board(board, fetch=request_json, pause=time.sleep, cache=None):
    base = base_url(board)
    jobs, total, incomplete = list_board(board, fetch, pause)
    rejected = total - len(jobs)
    details = []
    for index, (path, signature) in enumerate(jobs, 1):
        if index == 1 or index % 100 == 0: print(f'Workday board {board[0]}: fetching detail {index}/{len(jobs)}', flush=True)
        try:
            cached = cache.get(board, path, signature) if cache else None
            if cached is not None:
                details.append((path, cached))
                continue
            pause(1)
            result = fetch(base + path)
            info = result.get('jobPostingInfo') if isinstance(result, dict) else None
            if not isinstance(info, dict): raise ValueError('missing job detail')
            title, body = info.get('title'), info.get('jobDescription')
            if not isinstance(title, str) or not title.strip() or not isinstance(body, str) or not body.strip(): raise ValueError('missing job title or description')
            c = info.get('country'); c = c.get('descriptor') if isinstance(c, dict) else None
            country = COUNTRIES.get(c.strip().lower()) if isinstance(c, str) else None
            req = info.get('jobReqId')
            # Requisition identity is tenant-scoped, not hostname or path-scoped.
            if isinstance(req, str) and req.strip(): canonical_id = 'workday:' + board[1].lower() + ':req:' + req.strip().casefold()
            else: canonical_id = 'workday:' + board[1].lower() + ':path:' + path.casefold()
            payload = {'title': title, 'raw_description': body, 'country': country, 'published_at': None, 'canonical_id': canonical_id}
            if cache: cache.put(board, path, signature, payload)
            details.append((path, payload))
        except Exception:
            rejected += 1
            if rejected * 20 > total: raise ValueError('too many missing or invalid job details')
    if not details: raise ValueError('no usable job details')
    return details, rejected == 0 and not incomplete


class DetailCache:
    """Persistent, bounded-age cache; per-detail commits allow interrupted polls to resume."""
    def __init__(self, path, clock=time.time):
        self.clock = clock
        self.db = sqlite3.connect(path, timeout=30)
        self.db.execute('create table if not exists detail_cache(source text not null, path text not null, signature text not null, fetched_at integer not null, payload text not null, primary key(source,path))')
        self.db.commit()
    def get(self, board, path, signature):
        row = self.db.execute('select signature,fetched_at,payload from detail_cache where source=? and path=?', (':'.join(board),path)).fetchone()
        if not row or row[0] != signature or not 0 <= self.clock() - row[1] < 7 * 86400: return None
        return json.loads(row[2])
    def put(self, board, path, signature, payload):
        with self.db:
            self.db.execute('insert into detail_cache(source,path,signature,fetched_at,payload) values(?,?,?,?,?) on conflict(source,path) do update set signature=excluded.signature,fetched_at=excluded.fetched_at,payload=excluded.payload', (':'.join(board),path,signature,int(self.clock()),json.dumps(payload,separators=(',', ':'))))
    def close(self): self.db.close()


def initialize(db):
    db.execute('create table if not exists postings(id text primary key, source text not null, payload text not null, status text not null, missing integer not null)')
    db.execute('create table if not exists statistics_source_health(source text primary key, last_success_at integer, last_error text)')


def apply_board(db, board, jobs, complete=True):
    source = 'workday:' + ':'.join(board)
    previous = db.execute('select count(*) from postings where source=? and status="open"', (source,)).fetchone()[0]
    if not jobs or (previous >= 10 and len(jobs) < previous / 2): raise ValueError('empty or collapsed board held')
    with db:
        if complete: db.execute('update postings set missing=missing+1 where source=? and status="open"', (source,))
        for path, payload in jobs:
            row_id = source + ':' + path
            db.execute('''insert into postings(id,source,payload,status,missing) values(?,?,?,'open',0)
                on conflict(id) do update set payload=excluded.payload,status='open',missing=0''', (row_id, source, json.dumps(payload, separators=(',', ':'))))
        if complete:
            db.execute('update postings set status="closed" where source=? and status="open" and missing>=2', (source,))
            db.execute('insert into statistics_source_health(source,last_success_at,last_error) values(?,?,NULL) on conflict(source) do update set last_success_at=excluded.last_success_at,last_error=NULL', (source,int(time.time())))
        else:
            db.execute('insert into statistics_source_health(source,last_error) values(?,?) on conflict(source) do update set last_error=excluded.last_error', (source,'Partial board: listings or details unavailable; closures held'))


def collect_one(board, host_lock):
    # Lock is per-host for the full board; one in-flight board per host ensures
    # each board's explicit one-second request spacing also protects the host.
    with host_lock:
        cache = None
        try:
            cache = DetailCache(ROOT / 'workday-details.sqlite3')
            jobs, complete = fetch_board(board, cache=cache)
            with open(str(DB) + '.lock', 'a') as db_lock:
                fcntl.flock(db_lock, fcntl.LOCK_EX)
                with sqlite3.connect(DB, timeout=30) as db:
                    initialize(db); apply_board(db, board, jobs, complete)
            print(f'Workday board {board[0]}: {len(jobs)} postings; complete={complete}', flush=True)
            return True
        except Exception as error:
            print(f'Workday board {board[0]} failed: {error}', file=sys.stderr, flush=True)
            try:
                with open(str(DB) + '.lock', 'a') as db_lock:
                    fcntl.flock(db_lock, fcntl.LOCK_EX)
                    with sqlite3.connect(DB, timeout=30) as db:
                        initialize(db)
                        db.execute('insert into statistics_source_health(source,last_error) values(?,?) on conflict(source) do update set last_error=excluded.last_error', ('workday:' + ':'.join(board), str(error)[:500]))
            except Exception as health_error:
                print(f'Could not record Workday health: {health_error}', file=sys.stderr, flush=True)
            return False
        finally:
            if cache: cache.close()
            # A subsequent board on the same host must also respect request spacing.
            time.sleep(1)


def main():
    os.umask(0o077); ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(str(DB) + '.poll.lock', 'a') as poll_lock:
        fcntl.flock(poll_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks = {board[0]: threading.Lock() for board in BOARDS}
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda board: collect_one(board, locks[board[0]]), BOARDS))
        if not all(results): raise SystemExit('Workday collection incomplete; existing records retained for failed boards')

if __name__ == '__main__': main()
