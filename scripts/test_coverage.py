import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from coverage import build_coverage

class CoverageTest(unittest.TestCase):
    def test_records_one_row_per_day_and_excludes_source_names(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'source.sqlite3'
            with sqlite3.connect(path) as db:
                db.execute('create table postings(source text,status text)')
                db.execute('create table statistics_source_health(last_error text)')
                db.executemany('insert into postings values (?,?)',[('private-company','open'),('private-company','closed')])
                db.execute('insert into statistics_source_health values (NULL)')
            state={'sources':[{'source':'greenhouse:private-employer','open_postings':3}]}
            history=Path(temp)/'history.json'
            for _ in range(2): value=build_coverage(state,[('lever',path)],history)
            self.assertEqual(len(value['history']),1)
            self.assertEqual(value['history'][0]['boards'],2)
            self.assertEqual(value['history'][0]['postings'],4)
            self.assertNotIn('private',json.dumps(value))
