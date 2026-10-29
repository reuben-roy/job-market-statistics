#!/usr/bin/env python3
"""Run on the collector host: send only aggregate counts to the dashboard."""
import base64
import json
import pathlib
import subprocess
import sys
import urllib.request

root = pathlib.Path.home() / '.config' / 'job-statistics'
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
# Recheck after the locked read; don't publish an incomplete or rejected batch.
health = subprocess.run(['docker', 'exec', collector, 'job-board-collector', 'status', '--max-age-hours', '24'], capture_output=True, text=True, check=True)
state = json.loads(health.stdout)
if not state.get('healthy') or state.get('publish', {}).get('pending_changes') != 0 or state.get('publish', {}).get('recent_rejects'):
    raise SystemExit('Collector changed or publication failed; keeping previous snapshot')
if sum(group['postings'] for group in value['groups']) == 0:
    raise SystemExit('Collector snapshot is empty; keeping previous snapshot')
token = (root / 'refresh-token').read_text().strip()
request = urllib.request.Request('https://statistics.jobs.explosion.fun/internal/refresh', data=exporter.stdout, method='POST', headers={'Content-Type':'application/json', 'User-Agent':'JobApplicatorStatistics/1.0 (+https://jobs.explosion.fun)', 'Authorization':'Bearer ' + token})
with urllib.request.urlopen(request, timeout=60) as response:
    if response.status != 200:
        raise SystemExit('Snapshot upload failed')
print('Dashboard snapshot refreshed successfully')
