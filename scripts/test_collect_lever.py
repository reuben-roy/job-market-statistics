import importlib.util
import sqlite3
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('collect_lever', Path(__file__).parent / 'collect_lever.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

class CollectLeverTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('create table postings(id text primary key, source text not null, payload text not null, status text not null, missing integer not null)')
    def job(self, i):
        return {'id': str(i), 'text': 'Engineer', 'createdAt': 1767225600000, 'country': 'US', 'lists': [{'text': 'Requirements', 'content': '<li>Python</li>'}], 'salaryRange': {'min': 100000, 'max': 200000, 'interval': 'per-year-salary', 'currency': 'USD'}}
    def test_retain_closed_only_after_two_complete_polls(self):
        collector.apply_board(self.db, 'example', [self.job(1),self.job(2)])
        collector.apply_board(self.db, 'example', [self.job(1)])
        self.assertEqual(self.db.execute("select status from postings where id like '%:2'").fetchone()[0], 'open')
        collector.apply_board(self.db, 'example', [self.job(1)])
        self.assertEqual(self.db.execute("select status from postings where id like '%:2'").fetchone()[0], 'closed')
    def test_empty_or_collapse_leave_data_intact(self):
        collector.apply_board(self.db,'example',[self.job(i) for i in range(10)])
        with self.assertRaises(ValueError): collector.apply_board(self.db,'example',[self.job(1)])
        self.assertEqual(self.db.execute("select count(*) from postings where status='open' and missing=0").fetchone()[0],10)
    def test_annual_usd_only(self):
        j=self.job(1); self.assertEqual(collector.normalize(j)['salary_min'],100000)
        j['salaryRange']['interval']='per-hour'; self.assertNotIn('salary_min',collector.normalize(j))
        self.assertIn('<h2>Requirements</h2>',collector.normalize(j)['raw_description'])
        self.assertIsNone(collector.normalize(j)['published_at'])

if __name__ == '__main__': unittest.main()
