"""Export aggregate-only statistics from the collector journal, without exporting posting text."""
import base64
import collections
import datetime
import fcntl
import json
import os
import re
import sqlite3
import unicodedata
"""Conservatively select role-related sections from employer-provided HTML."""
import re
from html.parser import HTMLParser

EXCLUDED = re.compile(r'\b(benefits|perks|compensation|salary|pay range|pay transparency|equal opportunity|eeo|accommodations?|recruitment process|recruiting process|hiring process|interview process|how to apply|application process|privacy|about (?:the |our )?(?:company|us)|who we are|our company|our benefits|why join|fraud|notice to applicants)\b', re.I)
PREFERRED = re.compile(r'\b(preferred|nice to have|bonus points|bonus qualifications|desired qualifications)\b', re.I)
REQUIRED = re.compile(r'\b(requirements|qualifications|what (?:you|you.ll) (?:need|bring)|who you are|skills and experience|experience and skills|about you|your background|you have|must have|what we.re looking for)\b', re.I)
RESPONSIBILITIES = re.compile(r'\b(responsibilities|what you.ll do|what you will do|what you do|your role|your impact|the role|about the role|role overview|job description|position overview|your responsibilities|in this role|day to day)\b', re.I)

def classify(text):
    text = re.sub(r'\s+', ' ', text).strip(' :–—-\t\n')
    if not text or len(text) > 140: return None
    if EXCLUDED.search(text): return 'excluded'
    if PREFERRED.search(text): return 'preferred'
    if REQUIRED.search(text): return 'required'
    if RESPONSIBILITIES.search(text): return 'responsibilities'
    return None

class Sections(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.current = None
        self.sections = {'required': [], 'preferred': [], 'responsibilities': []}
        self.heading = None
        self.ignored = 0
        self.found = False
    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in ('script', 'style'): self.ignored += 1; return
        if self.ignored: return
        if tag in ('h1','h2','h3','h4','h5','h6','strong','b') and self.heading is None:
            self.heading = [tag, []]
        elif tag in ('p','li','br','div') and self.current in self.sections:
            self.sections[self.current].append('\n')
    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ('script','style') and self.ignored: self.ignored -= 1; return
        if self.ignored: return
        if self.heading and tag == self.heading[0]:
            text = ''.join(self.heading[1]); kind = classify(text)
            if kind:
                self.current = kind
                if kind in self.sections: self.found = True
            elif tag.startswith('h'):
                self.current = None
            elif self.current in self.sections:
                self.sections[self.current].append(text + ' ')
            self.heading = None
        elif tag in ('p','li','div') and self.current in self.sections:
            self.sections[self.current].append('\n')
    def handle_data(self, text):
        if self.ignored: return
        if self.heading is not None: self.heading[1].append(text)
        elif self.current in self.sections: self.sections[self.current].append(text)

def extract(html):
    parser = Sections()
    parser.feed(html or '')
    # Discard recurring candidate-facing process boilerplate even if the employer omitted a heading.
    noise = re.compile(r'\b(?:reasonable accommodations?|applicants? with disabilities|candidates? with disabilities|recruiting (?:team|process)|recruitment process|hiring process|application process|equal opportunity employer)\b', re.I)
    return {key: '\n'.join(line for line in ''.join(value).splitlines() if not noise.search(line)) for key, value in parser.sections.items()}, parser.found


vocab = json.loads(base64.b64decode(os.environ['STATS_VOCAB_B64']))
path = os.environ.get('COLLECTOR_DATABASE', '/data/collector.sqlite3')
# Use the collector's existing lock: a refresh must not observe an in-flight run.
with open(path + '.lock', 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    db = sqlite3.connect('file:' + path + '?mode=ro', uri=True)
    query = "select payload, status, id from postings" if os.environ.get("STATISTICS_ONLY") == "1" else "select payload, status, feed_id from postings where feed_id is not null"
    rows = db.execute(query).fetchall()
    db.close()
    fcntl.flock(lock, fcntl.LOCK_UN)
unique = {}
for index,(payload,status,stored_id) in enumerate(rows):
    record=json.loads(payload)
    identity=record.get('canonical_id') or record.get('feed_id') or record.get('canonical_url') or stored_id or ('row',index)
    old=unique.get(identity)
    if old is None or (status=='open' and old[1]!='open'): unique[identity]=(record,status)
postings=list(unique.values())

def norm(s):
    return unicodedata.normalize('NFKC', s or '').lower()

def detect(text):
    text = norm(text)
    found = []
    for skill in vocab['skills']:
        for alias in skill['aliases']:
            alias = norm(alias)
            start = 0
            while (index := text.find(alias, start)) >= 0:
                end = index + len(alias)
                word = lambda c: c.isalnum() or c == '_'
                if (index == 0 or not word(text[index - 1])) and (end == len(text) or not word(text[end])):
                    found.append(skill['id'])
                    break
                start = end
            if skill['id'] in found:
                break
    return found

def role(title):
    title = norm(title)
    rules = {'engineering': r'\b(engineer|developer|software|devops)\b', 'data': r'\b(data scientist|data analyst|machine learning)\b', 'design': r'\b(designer|design lead)\b', 'sales': r'\b(sales|account executive)\b', 'operations': r'\b(operations|recruiter|human resources)\b'}
    matches = [name for name, pattern in rules.items() if re.search(pattern, title)]
    return matches[0] if len(matches) == 1 else 'unknown'

def country(value):
    return value if value and re.fullmatch(r'[A-Z]{2}', value) else 'unknown'

# Each bucket is disjoint, so the browser can sum filtered posting counts without receiving records.
buckets = {}
for p, status in postings:
    try:
        published_on = datetime.date.fromisoformat((p.get('published_at') or '')[:10]).isoformat()
        if published_on > datetime.datetime.now(datetime.timezone.utc).date().isoformat(): published_on = None
    except (TypeError, ValueError):
        published_on = None
    key = (role(p.get('title', '')), country(p.get('country')), 'unknown', status, published_on)
    group = buckets.setdefault(key, {'role': key[0], 'country': key[1], 'industry': key[2], 'status': key[3], 'published_on': key[4], 'postings': 0, 'classified': 0, 'with_skills': 0, 'skills': collections.Counter(), 'sections': {name: collections.Counter() for name in ('required', 'preferred', 'responsibilities')}, 'salary': {'count': 0, 'min_sum': 0, 'max_sum': 0}})
    sections, classified = extract(p.get('raw_description') or p.get('description') or '')
    by_section = {name: detect(text) for name, text in sections.items()}
    skills = set(skill for found in by_section.values() for skill in found)
    group['classified'] += classified
    for name, found in by_section.items(): group['sections'][name].update(found)
    low, high = p.get('salary_min'), p.get('salary_max')
    if p.get('currency') == 'USD' and type(low) is int and type(high) is int and 15000 <= low <= high <= 3000000:
        group['salary']['count'] += 1
        group['salary']['min_sum'] += low
        group['salary']['max_sum'] += high
    group['postings'] += 1
    group['with_skills'] += bool(skills)
    group['skills'].update(skills)
print(json.dumps({'schema_version': 3, 'vocabulary_version': vocab['version'], 'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source': 'collector snapshot', 'groups': list(buckets.values())}, separators=(',', ':')))
