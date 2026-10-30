import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from freshness import source_freshness

spec=importlib.util.spec_from_file_location('lever',Path(__file__).parent/'collect_lever.py')
lever=importlib.util.module_from_spec(spec);spec.loader.exec_module(lever)

def job(i):
    return {'id':str(i), 'text':'Engineer', 'lists':[{'text':'Requirements','content':'<li>Python</li>'}]}

def raise_error(_):
    raise OSError('network error')

class SourceHealthTest(unittest.TestCase):
    def setUp(self):
        self.dir=tempfile.TemporaryDirectory();self.path=Path(self.dir.name)/'data.sqlite3'
        self.db=sqlite3.connect(self.path)
        self.db.execute('create table postings(id text primary key, source text not null, payload text not null, status text not null, missing integer not null)')
        lever.initialize_health(self.db)
    def tearDown(self): self.db.close();self.dir.cleanup()
    def test_failure_retains_old_postings_and_timestamp_and_other_board_proceeds(self):
        self.assertTrue(lever.collect_board(self.db,'first',lambda _: [job(1),job(2)],lambda:100))
        before=self.db.execute('select * from postings where source="first" order by id').fetchall()
        self.assertFalse(lever.collect_board(self.db,'first',raise_error,lambda:200))
        self.assertEqual(before,self.db.execute('select * from postings where source="first" order by id').fetchall())
        self.assertTrue(lever.collect_board(self.db,'second',lambda _: [job(3)],lambda:300))
        self.assertEqual(source_freshness(self.path),'1970-01-01T00:01:40+00:00')
        self.assertEqual(self.db.execute('select last_success_at from statistics_source_health where source="first"').fetchone()[0],100)
    def test_empty_board_and_unknown_old_freshness(self):
        self.assertFalse(lever.collect_board(self.db,'empty',lambda _: [],lambda:100))
        self.assertEqual(source_freshness(self.path),'1970-01-01T00:00:00+00:00')
        self.assertTrue(lever.collect_board(self.db,'empty',lambda _: [job(1)],lambda:100))
        self.db.execute("insert into postings values ('legacy','legacy','{}','open',0)");self.db.commit()
        self.assertEqual(source_freshness(self.path),'1970-01-01T00:00:00+00:00')
    def test_recovery_resets_failure(self):
        lever.collect_board(self.db,'first',raise_error)
        lever.collect_board(self.db,'first',lambda _: [job(1)],lambda:300)
        self.assertEqual(self.db.execute('select last_success_at,last_error from statistics_source_health where source="first"').fetchone(),(300,None))
        self.assertEqual(source_freshness(self.path),'1970-01-01T00:05:00+00:00')

if __name__=='__main__':unittest.main()
