import base64
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class SnapshotExportTest(unittest.TestCase):
    def test_counts_open_published_postings_once_without_names_or_text(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'collector.sqlite3'
            db = sqlite3.connect(path)
            db.execute('create table postings(payload text, status text, feed_id text)')
            rows = [
                ({'company':'Private Company', 'title':'Software Engineer', 'raw_description':'<h2>Requirements</h2><p>Python Python SQL</p><p>We offer reasonable accommodations during the recruiting process.</p><h2>Recruiting process</h2><p>Recruiting team</p>', 'salary_min':100000, 'salary_max':200000, 'currency':'USD', 'country':'US', 'published_at':'2026-01-15T00:00:00Z'}, 'open', 'id1'),
                ({'company':'Other Company', 'title':'Software Engineer', 'raw_description':'<h2>Responsibilities</h2><p>Python</p>', 'country':'US', 'published_at':'2026-01-15T00:00:00Z'}, 'open', 'id2'),
                ({'company':'Closed Company', 'title':'Engineer', 'raw_description':'<h2>Responsibilities</h2><p>Python</p>', 'country':'US', 'published_at':'2026-01-15T00:00:00Z'}, 'closed', 'id3'),
                ({'company':'Pending Company', 'title':'Engineer', 'raw_description':'<h2>Requirements</h2><p>SQL</p>', 'country':'US', 'published_at':'2026-01-15T00:00:00Z'}, 'open', None),
            ]
            rows.append(rows[0])
            db.executemany('insert into postings values (?,?,?)', [(json.dumps(p), status, feed) for p,status,feed in rows]); db.commit(); db.close()
            vocab = base64.b64encode((ROOT/'vocabulary.json').read_bytes()).decode()
            result = subprocess.run([sys.executable, str(ROOT/'scripts/export_snapshot.py')], env={**os.environ, 'COLLECTOR_DATABASE':str(path), 'STATS_VOCAB_B64':vocab}, capture_output=True, text=True, check=True)
            snapshot = json.loads(result.stdout); group = snapshot['groups'][0]
            self.assertEqual(len(snapshot['groups']), 2)
            self.assertEqual(sum(g['postings'] for g in snapshot['groups']), 3)
            self.assertEqual(next(g for g in snapshot['groups'] if g['status'] == 'closed')['postings'], 1)
            self.assertEqual(group['postings'], 2)
            self.assertEqual(group['published_on'], '2026-01-15')
            self.assertEqual(group['status'], 'open')
            self.assertEqual(group['skills']['python'], 2)
            self.assertEqual(group['skills']['sql'], 1)
            self.assertNotIn('recruiting', group['skills'])
            self.assertEqual(group['classified'], 2)
            self.assertEqual(group['sections']['required']['python'], 1)
            self.assertEqual(snapshot['schema_version'], 4)
            self.assertEqual(sum(group['patterns'].values()), group['postings'])
            self.assertEqual(len(group['patterns']), 2)
            self.assertEqual(group['salary'], {'count': 1, 'min_sum': 100000, 'max_sum': 200000})
            self.assertNotIn('Private Company', result.stdout)
            self.assertNotIn('Software Engineer', result.stdout)
            self.assertNotIn('id1', result.stdout)

if __name__ == '__main__': unittest.main()
