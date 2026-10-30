import importlib.util
import sqlite3
import unittest
import tempfile
import threading
import time
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('workday', Path(__file__).parent / 'collect_workday.py')
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
BOARD = ('example.wd5.myworkdayjobs.com','example','Careers')

def job(n):
    return {'jobPostingInfo': {'title': f'Engineer {n}', 'jobDescription': '<h2>Requirements</h2><p>Python</p>', 'country': {'descriptor': 'United States of America'}, 'startDate': '2026-10-30'}}

class WorkdayTest(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');w.initialize(self.db)
    def test_complete_pagination_and_details(self):
        calls=[]
        def fetch(url,data=None):
            calls.append((url,data));
            if data is not None:
                a=data['offset'];return {'total':21 if a == 0 else 0,'jobPostings':[{'externalPath':f'/job/A/job_{i}'} for i in range(a,min(a+20,21))]}
            return job(url.rsplit('_',1)[-1])
        rows,complete=w.fetch_board(BOARD,fetch,lambda _:None)
        self.assertTrue(complete)
        self.assertEqual(len(rows),21);self.assertEqual(len(calls),24)
        self.assertEqual(rows[0][1]['country'],'US');self.assertIsNone(rows[0][1]['published_at'])
    def test_capped_or_incomplete_are_rejected(self):
        for response in [{'total':2000,'jobPostings':[]},{'total':5,'jobPostings':[]}]:
            with self.assertRaises(ValueError): w.fetch_board(BOARD,lambda *args:response,lambda _:None)
    def test_partial_list_holds_closures_and_marks_health(self):
        def fetch(url,data=None):
            if data is not None:
                start=data['offset']; rows=[{'externalPath':f'/job/A/job_{i}'} for i in range(start,min(20,start+20))]
                if start==20: rows=[{'bulletFields':['id']}]
                return {'total':21 if not start else 0,'jobPostings':rows}
            return job(1)
        rows,complete=w.fetch_board(BOARD,fetch,lambda _:None)
        self.assertFalse(complete);self.assertEqual(len(rows),20)
        w.apply_board(self.db,BOARD,[('/job/old',{'title':'Old'}), *rows])
        w.apply_board(self.db,BOARD,rows,complete)
        w.apply_board(self.db,BOARD,rows,complete)
        self.assertEqual(self.db.execute("select count(*) from postings where status='closed'").fetchone()[0],0)
        self.assertIn('Partial board', self.db.execute('select last_error from statistics_source_health').fetchone()[0])
    def test_minor_detail_failures_keep_valid_records_without_closures(self):
        def fetch(url,data=None):
            if data is not None:
                start=data['offset']; return {'total':21 if not start else 0,'jobPostings':[{'externalPath':f'/job/A/job_{i}'} for i in range(start,min(start+20,21))]}
            if url.endswith('_3'): raise OSError('temporary failure')
            return job(1)
        rows,complete=w.fetch_board(BOARD,fetch,lambda _:None)
        self.assertFalse(complete);self.assertEqual(len(rows),20)
        w.apply_board(self.db,BOARD,[('/job/old',{'title':'Old'}), *rows])
        w.apply_board(self.db,BOARD,rows,complete)
        self.assertEqual(self.db.execute("select count(*) from postings where missing>0 or status='closed'").fetchone()[0],0)
        self.assertIn('Partial board',self.db.execute('select last_error from statistics_source_health').fetchone()[0])
    def test_excessive_detail_failures_abort_board(self):
        def fetch(url,data=None):
            if data is not None:
                start=data['offset']; return {'total':21 if not start else 0,'jobPostings':[{'externalPath':f'/job/A/job_{i}'} for i in range(start,min(start+20,21))]}
            if url.endswith(('_3','_4')): return {'jobPostingInfo':{}}
            return job(1)
        with self.assertRaises(ValueError): w.fetch_board(BOARD,fetch,lambda _:None)
    def test_missing_detail_rejected(self):
        def fetch(url,data=None):
            return {'total':1,'jobPostings':[{'externalPath':'/job/A/job_1'}]} if data else {'jobPostingInfo':{'title':'Engineer'}}
        with self.assertRaises(ValueError): w.fetch_board(BOARD,fetch,lambda _:None)
    def test_closures_require_two_successful_complete_polls(self):
        jobs=[('/job/a',job(1)['jobPostingInfo']),('/job/b',job(2)['jobPostingInfo'])]
        w.apply_board(self.db,BOARD,jobs);w.apply_board(self.db,BOARD,jobs[:1]);
        self.assertEqual(self.db.execute("select count(*) from postings where status='closed'").fetchone()[0],0)
        w.apply_board(self.db,BOARD,jobs[:1]);self.assertEqual(self.db.execute("select count(*) from postings where status='closed'").fetchone()[0],1)
    def test_collapse_is_atomic(self):
        jobs=[(f'/job/{i}', {'title':'Engineer'}) for i in range(10)];w.apply_board(self.db,BOARD,jobs)
        with self.assertRaises(ValueError):w.apply_board(self.db,BOARD,jobs[:1])
        self.assertEqual(self.db.execute('select count(*) from postings where missing=0').fetchone()[0],10)
    def test_health_for_first_poll_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); dbpath=root/'workday-statistics.sqlite3'
            with patch.object(w,'ROOT',root), patch.object(w,'DB',dbpath), patch.object(w,'BOARDS',[BOARD]), patch.object(w,'fetch_board',side_effect=ValueError('temporary outage')):
                with self.assertRaises(SystemExit):w.main()
            with sqlite3.connect(dbpath) as db:
                row=db.execute('select source,last_success_at,last_error from statistics_source_health').fetchone()
                self.assertEqual(row,('workday:'+':'.join(BOARD),None,'temporary outage'))
    def test_partitioned_list_complete_and_disjoint(self):
        paths=[f'/job/A/job_{i}' for i in range(7)]
        def fetch(url,data=None):
            facets=data['appliedFacets']; offset=data['offset']
            if facets.get('kind') == ['a']:
                chosen=paths[:3]
            elif facets.get('kind') == ['b']:
                chosen=paths[3:]
            else: chosen=paths
            result={'total':len(chosen) if not offset else 0,'jobPostings':[{'externalPath':p} for p in chosen[offset:offset+2]]}
            if not facets: result['facets']=[{'facetParameter':'kind','values':[{'id':'a','count':3},{'id':'b','count':4}]}]
            elif facets.get('kind') == ['b']: result['facets']=[{'facetParameter':'region','values':[{'id':'x','count':2},{'id':'y','count':2}]}]
            if facets.get('region')==['x']: chosen=paths[3:5]
            if facets.get('region')==['y']: chosen=paths[5:7]
            result['total']=len(chosen) if not offset else 0;result['jobPostings']=[{'externalPath':p} for p in chosen[offset:offset+2]]
            return result
        with patch.object(w,'CXS_CAP',4), patch.object(w,'PAGE',2):
            found,total,partial=w.list_board(BOARD,fetch,lambda _:None)
            self.assertEqual([path for path, _ in found],paths);self.assertEqual(total,7);self.assertFalse(partial)
    def test_capped_fallback_is_explicitly_partial(self):
        def fetch(url,data=None):
            offset=data['offset']; return {'total':4 if not offset else 0,'jobPostings':[{'externalPath':f'/job/{i}'} for i in range(offset,offset+2)]}
        with patch.object(w,'CXS_CAP',4), patch.object(w,'PAGE',2):
            rows,total,partial=w.list_board(BOARD,fetch,lambda _:None)
            self.assertEqual(total,4);self.assertEqual(len(rows),4);self.assertTrue(partial)
    def test_cache_persists_and_expires(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'cache.sqlite3'; clock=[1000000]
            c=w.DetailCache(path,lambda:clock[0]);c.put(BOARD,'/job/a','sig',{'title':'Engineer'});c.close()
            c=w.DetailCache(path,lambda:clock[0]);self.assertEqual(c.get(BOARD,'/job/a','sig'),{'title':'Engineer'})
            self.assertIsNone(c.get(BOARD,'/job/a','changed'))
            clock[0] += 7*86400; self.assertIsNone(c.get(BOARD,'/job/a','sig'));c.close()
    def test_cache_resumes_and_invalidates_changed_listing(self):
        clock=[1000000];calls=[]
        def fetch(url,data=None):
            if data is not None:return {'total':1,'jobPostings':[{'externalPath':'/job/A/job_1','title':'v1'}]}
            calls.append(url);return job(1)
        with tempfile.TemporaryDirectory() as directory:
            c=w.DetailCache(Path(directory)/'cache.sqlite3',lambda:clock[0]);w.fetch_board(BOARD,fetch,lambda _:None,cache=c);w.fetch_board(BOARD,fetch,lambda _:None,cache=c)
            self.assertEqual(len(calls),1);clock[0]+=7*86400;w.fetch_board(BOARD,fetch,lambda _:None,cache=c);self.assertEqual(len(calls),2);c.close()
    def test_requisition_id_and_fallback(self):
        def fetch(url,data=None):
            if data is not None:return {'total':2,'jobPostings':[{'externalPath':'/job/A/job_1'},{'externalPath':'/job/A/job_2'}]}
            x=job(1)
            if url.endswith('_1'):x['jobPostingInfo']['jobReqId']='R123'
            return x
        rows,complete=w.fetch_board(BOARD,fetch,lambda _:None)
        self.assertTrue(complete);self.assertEqual(rows[0][1]['canonical_id'],'workday:example:req:r123');self.assertEqual(rows[1][1]['canonical_id'],'workday:example:path:/job/a/job_2')
    def test_parallel_boards_are_bounded_and_failure_isolated(self):
        boards=[(f'b{i}.wd5.myworkdayjobs.com',f'b{i}','Careers') for i in range(5)]
        boards.append((boards[0][0],boards[0][1],'Second'))
        lock=threading.Lock();state={'active':0,'max':0,'hosts':set(),'duplicate':False}
        def fake_fetch(board,cache=None):
            with lock:
                state['active']+=1;state['max']=max(state['max'],state['active'])
                if board[0] in state['hosts']:state['duplicate']=True
                state['hosts'].add(board[0])
            time.sleep(.05)
            with lock:state['hosts'].remove(board[0]);state['active']-=1
            if board[1]=='b2':raise ValueError('fake failure')
            return [('/job/a',{'title':'Engineer'})],True
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);dbpath=root/'workday-statistics.sqlite3'
            with patch.object(w,'ROOT',root),patch.object(w,'DB',dbpath),patch.object(w,'BOARDS',boards),patch.object(w,'fetch_board',side_effect=fake_fetch):
                with self.assertRaises(SystemExit):w.main()
            self.assertGreater(state['max'],1);self.assertLessEqual(state['max'],4);self.assertFalse(state['duplicate'])
            with sqlite3.connect(dbpath) as db:
                self.assertEqual(db.execute('select count(*) from postings').fetchone()[0],5)
                self.assertEqual(db.execute("select count(*) from statistics_source_health where last_error='fake failure'").fetchone()[0],1)
    def test_reject_untrusted_hosts_and_paths(self):
        with self.assertRaises(ValueError): w.base_url(('evil.example','evil','Careers'))
        with self.assertRaises(ValueError): w.fetch_board(BOARD,lambda *args:{'total':1,'jobPostings':[{'externalPath':'/job/../../oops'}]},lambda _:None)

if __name__ == '__main__': unittest.main()
