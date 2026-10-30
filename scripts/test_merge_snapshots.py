import copy
import unittest
from merge_snapshots import merge_snapshots

GROUP = {'role':'data','country':'US','industry':'unknown','status':'open','published_on':'2026-01-01','postings':2,'classified':2,'with_skills':1,'skills':{'python':1},'sections':{'required':{'python':1},'preferred':{},'responsibilities':{}},'salary':{'count':1,'min_sum':100000,'max_sum':200000}}

def snap(group, stamp='2026-10-28T10:00:00+00:00'):
    return {'schema_version':3,'vocabulary_version':'1.1.0','source':'collector snapshot','generated_at':stamp,'groups':[group]}

class SnapshotMergeTest(unittest.TestCase):
    def test_merges_counts_sections_and_salary_without_mutating_input(self):
        left=snap(copy.deepcopy(GROUP)); right=snap(copy.deepcopy(GROUP),'2026-10-28T11:00:00+00:00'); before=copy.deepcopy(left)
        value,data=merge_snapshots([left,right]); g=value['groups'][0]
        self.assertEqual((g['postings'],g['skills']['python'],g['sections']['required']['python']),(4,2,2))
        self.assertEqual(g['salary'],{'count':2,'min_sum':200000,'max_sum':400000})
        self.assertEqual(value['generated_at'],left['generated_at']);self.assertEqual(left,before)
        self.assertIsInstance(data,bytes)
    def test_never_merges_different_dates_or_statuses(self):
        other=copy.deepcopy(GROUP);other['status']='closed';self.assertEqual(len(merge_snapshots([snap(GROUP),snap(other)])[0]['groups']),2)
    def test_rejects_incompatible_data(self):
        other=snap(GROUP);other['vocabulary_version']='2.0.0'
        with self.assertRaises(ValueError):merge_snapshots([snap(GROUP),other])
    def test_requires_known_timestamp_timezone(self):
        with self.assertRaises(ValueError):merge_snapshots([snap(GROUP,'2026-10-28T10:00:00')])

if __name__=='__main__':unittest.main()

class PatternMergeTest(unittest.TestCase):
    def test_exact_patterns_survive_bucket_merging(self):
        g=copy.deepcopy(GROUP); g['patterns']={'1.0.0':1,'0.0.0':1}
        a=snap(g); a['schema_version']=4
        result,_=merge_snapshots([a,a]); self.assertEqual(result['groups'][0]['patterns'],{'1.0.0':2,'0.0.0':2})
