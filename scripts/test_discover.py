import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('discover',Path(__file__).with_name('discover.py'))
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)

class Tests(unittest.TestCase):
 def test_extract_board_urls_without_slug_guessing(self):
  cases=[('https://example.wd5.myworkdayjobs.com/en-US/Careers/job/title','workday','Careers'),('https://jobs.smartrecruiters.com/Example/123','smartrecruiters','Example'),('https://jobs.lever.co/example/123','lever','example'),('https://jobs.ashbyhq.com/example/123','ashby','example'),('https://boards.greenhouse.io/embed/job_board?for=example','greenhouse','example'),('https://example.wd1.myworkdayjobs.com/Search','workday','Search')]
  for url,ats,board in cases:
   with self.subTest(url=url): self.assertEqual((d.candidate(url)['ats'],d.candidate(url)['board']),(ats,board))
  self.assertIsNone(d.candidate('https://jobs.smartrecruiters.com/oneclick-ui/x'))
  self.assertIsNone(d.candidate('http://jobs.lever.co/example/123'))
  self.assertIsNone(d.candidate('https://evil.com/jobs/example'))
 def test_links_must_come_from_visited_company_page(self):
  pages={'https://example.com/careers':{'url':'https://example.com/careers','html':'<a href="https://jobs.lever.co/acme/123">jobs</a><a href="https://other.com/careers">other</a>'},'https://careers.example.com/':{'url':'https://careers.example.com/','html':'<p>none</p>'},'https://example.com/':{'url':'https://example.com/','html':'<a href="/careers/teams">Our teams</a>'},'https://example.com/careers/teams':{'url':'https://example.com/careers/teams','html':'<a href="https://boards.greenhouse.io/acme">Jobs</a>'}}
  calls=[]
  def fetch(url,domain):calls.append(url);return pages[url]
  result=d.discover({'rank':'1','name':'Example','domain':'example.com'},fetcher=fetch,delay=0)
  self.assertEqual({c['ats'] for c in result['candidates']},{'lever','greenhouse'})
  self.assertNotIn('https://other.com/careers',calls)
  self.assertEqual(result['status'],'candidates')
 def test_redirect_only_accepts_known_ats(self):
  def fetch(url,domain): return {'redirect':'https://other.example/jobs'}
  result=d.discover({'rank':'1','name':'Example','domain':'example.com'},fetcher=fetch,delay=0)
  self.assertEqual(result['status'],'unresolved')
 def test_domain_check(self):
  self.assertTrue(d.belongs('https://careers.example.com/job','example.com'))
  self.assertFalse(d.belongs('https://example.com.evil.com/job','example.com'))
  self.assertFalse(d.belongs('https://user@example.com/job','example.com'))

if __name__=='__main__': unittest.main()
