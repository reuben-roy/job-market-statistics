import importlib.util
import sqlite3
import unittest
from pathlib import Path

s=importlib.util.spec_from_file_location('sr',Path(__file__).parent/'collect_smartrecruiters.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def row(i): return {'id':str(i),'name':'Engineer','visibility':'PUBLIC','releasedDate':'2026-10-01T00:00:00Z'}
def detail(i): return {'id':str(i),'name':'Engineer','visibility':'PUBLIC','active':True,'releasedDate':'2026-10-01T00:00:00Z','location':{'country':'us'},'jobAd':{'sections':{'companyDescription':{'text':'Recruiting'},'jobDescription':{'text':'<p>Build software</p>'},'qualifications':{'text':'<p>Python</p>'}}}}

class SmartRecruitersTest(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');m.initialize(self.db);self.db.commit()
 def test_page_completeness(self):
  def fetch(url):
   offset=int(url.split('offset=')[1].split('&')[0]);total=101
   return {'totalFound':total,'offset':offset,'content':[row(i) for i in range(offset,min(offset+100,total))]}
  self.assertEqual(len(m.list_board('test',fetch,lambda _:None)),101)
  def bad(url):return {'totalFound':2,'offset':0,'content':[row(1)]}
  with self.assertRaises(ValueError):m.list_board('test',bad,lambda _:None)
 def test_closure_and_preservation(self):
  p=m.normalize(detail(1),'1');m.apply_board(self.db,'test',[('1',p),('2',p)],[],100)
  m.apply_board(self.db,'test',[('1',p)],[],200)
  self.assertEqual(self.db.execute("select status from postings where id like '%:2'").fetchone()[0],'open')
  m.apply_board(self.db,'test',[('1',p)],[],300)
  self.assertEqual(self.db.execute("select status from postings where id like '%:2'").fetchone()[0],'closed')
  before=self.db.execute('select * from postings order by id').fetchall()
  with self.assertRaises(ValueError):m.apply_board(self.db,'test',[],[],400)
  self.assertEqual(before,self.db.execute('select * from postings order by id').fetchall())
 def test_cache_and_changed_listing(self):
  calls=[]
  def fetch(url):
   calls.append(url)
   if '?' in url:return {'totalFound':1,'offset':0,'content':[row(1)]}
   return detail(1)
  jobs,updates=m.fetch_board('test',{},fetch,lambda _:None,100);m.apply_board(self.db,'test',jobs,updates,100)
  calls.clear();jobs,_=m.fetch_board('test',m.cached_details(self.db,'test'),fetch,lambda _:None,200)
  self.assertEqual(len(calls),1);self.assertEqual(jobs[0][1]['country'],'US');self.assertEqual(jobs[0][1]['canonical_id'],'smartrecruiters:test:1');self.assertNotIn('Recruiting',jobs[0][1]['raw_description'])
  calls.clear();m.fetch_board('test',m.cached_details(self.db,'test'),fetch,lambda _:None,100+m.CACHE_SECONDS)
  self.assertEqual(len(calls),2)
 def test_bad_detail_prevents_snapshot(self):
  def fetch(url):
   if '?' in url:return {'totalFound':1,'offset':0,'content':[row(1)]}
   return detail(2)
  with self.assertRaises(ValueError):m.fetch_board('test',{},fetch,lambda _:None,100)
  self.assertEqual(self.db.execute('select count(*) from postings').fetchone()[0],0)

if __name__=='__main__':unittest.main()
