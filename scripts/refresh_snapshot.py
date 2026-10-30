#!/usr/bin/env python3
"""Run on the collector host: send only aggregate counts to the dashboard."""
import fcntl
import base64
import json
import os

from merge_snapshots import merge_snapshots
from freshness import source_freshness
from coverage import build_coverage
import pathlib
import subprocess
import sys
import urllib.request

root = pathlib.Path.home() / '.config' / 'job-statistics'
refresh_lock = (root / 'refresh.lock').open('a')
try:
    fcntl.flock(refresh_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit('Another snapshot refresh is already running')
names = subprocess.run(['docker', 'ps', '--format', '{{.Names}}'], capture_output=True, text=True, check=True).stdout.splitlines()
collectors = [name for name in names if name.startswith('collector-')]
if len(collectors) != 1:
    raise SystemExit('Expected exactly one running collector container')
collector = collectors[0]
health = subprocess.run(['docker', 'exec', collector, 'job-board-collector', 'status', '--max-age-hours', '24'], capture_output=True, text=True, check=True)
state = json.loads(health.stdout)
if not state.get('healthy') or state.get('publish', {}).get('pending_changes') != 0 or state.get('publish', {}).get('recent_rejects'):
    raise SystemExit('Collector unhealthy, publication backlog or rejects; keeping previous snapshot')
vocab = base64.b64encode((root / 'vocabulary.json').read_bytes()).decode('ascii')
exporter = subprocess.run(['docker', 'exec', '-i', '-e', 'STATS_VOCAB_B64=' + vocab, collector, 'python3', '-'], input=(root / 'export_snapshot.py').read_bytes(), capture_output=True, check=True)
value = json.loads(exporter.stdout)
# Statistics-only sources have their own journal; they never enter the desktop app's outbox.
if os.environ.get('STATS_SKIP_COLLECTION') != '1':
    subprocess.run([sys.executable, str(root / 'collect_lever.py')], check=True)
env = {**os.environ, 'STATS_VOCAB_B64': vocab, 'COLLECTOR_DATABASE': str(root / 'statistics-only.sqlite3'), 'STATISTICS_ONLY': '1'}
extra_freshness = source_freshness(root / 'statistics-only.sqlite3')
extra = subprocess.run([sys.executable, str(root / 'export_snapshot.py')], env=env, capture_output=True, check=True)
extra_value = json.loads(extra.stdout)
extra_value['generated_at'] = extra_freshness
snapshots = [value, extra_value]
# Workday polls independently, so slow or failed collection does not block daily refresh.
workday_db = root / 'workday-statistics.sqlite3'
for database_name in ('workday-statistics.sqlite3','smartrecruiters-statistics.sqlite3'):
    database = root / database_name
    if not database.exists(): continue
    independent_env = {**env, 'COLLECTOR_DATABASE': str(database)}
    independent_freshness = source_freshness(database)
    independent = subprocess.run([sys.executable, str(root / 'export_snapshot.py')], env=independent_env, capture_output=True, check=True)
    independent_value = json.loads(independent.stdout)
    independent_value['generated_at'] = independent_freshness
    snapshots.append(independent_value)
value, output = merge_snapshots(snapshots)
# Recheck after the locked read; don't publish an incomplete or rejected batch.
health = subprocess.run(['docker', 'exec', collector, 'job-board-collector', 'status', '--max-age-hours', '24'], capture_output=True, text=True, check=True)
state = json.loads(health.stdout)
if not state.get('healthy') or state.get('publish', {}).get('pending_changes') != 0 or state.get('publish', {}).get('recent_rejects'):
    raise SystemExit('Collector changed or publication failed; keeping previous snapshot')
if sum(group['postings'] for group in value['groups']) == 0:
    raise SystemExit('Collector snapshot is empty; keeping previous snapshot')
value['coverage']=build_coverage(state,[('lever',root/'statistics-only.sqlite3'),('workday',workday_db),('smartrecruiters',root/'smartrecruiters-statistics.sqlite3')],root/'coverage-history.json')
output=json.dumps(value,separators=(',',':')).encode()
if len(output)>5_000_000: raise SystemExit('Snapshot including coverage exceeds size limit')
token = (root / 'refresh-token').read_text().strip()
request = urllib.request.Request('https://statistics.jobs.explosion.fun/internal/refresh', data=output, method='POST', headers={'Content-Type':'application/json', 'User-Agent':'JobApplicatorStatistics/1.0 (+https://jobs.explosion.fun)', 'Authorization':'Bearer ' + token})
with urllib.request.urlopen(request, timeout=60) as response:
    if response.status != 200:
        raise SystemExit('Snapshot upload failed')
print('Dashboard snapshot refreshed successfully')
