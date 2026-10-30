#!/usr/bin/env python3
"""Bounded first-party career-site discovery; never guesses ATS tenant names.

Append-only JSONL checkpoints permit interruption and resume. Results are candidates for a
separate live API validation, not an instruction to activate the board.
"""
from __future__ import annotations
import argparse
import csv
import html
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import re
import socket
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

UA = 'JobApplicatorDiscovery/1.0 (+https://jobs.explosion.fun)'
MAX_BYTES = 2_000_000
LOCALE = re.compile(r'^[a-z]{2}(?:-[A-Z]{2})?$', re.I)
TOKEN = re.compile(r'^[A-Za-z0-9_.-]{1,120}$')
WORKDAY = re.compile(r'^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$',re.I)
SKIP = {'job','jobs','v1','api','embed','oneclick-ui','posting-api','job-board','apply','search','careers'}
CAREER = re.compile(r'\b(career|careers|jobs|join.?us|work.?with.?us|employment|opportunities|hiring)\b',re.I)
URLS = re.compile(r'https?://[^\s\"\'<>\\]+',re.I)

class Links(HTMLParser):
    def __init__(self): super().__init__(convert_charrefs=True); self.links=[]; self.href=None; self.parts=[]
    def handle_starttag(self,tag,attrs):
        if tag.lower()=='a': self.href=dict(attrs).get('href');self.parts=[]
    def handle_data(self,data):
        if self.href is not None: self.parts.append(data)
    def handle_endtag(self,tag):
        if tag.lower()=='a' and self.href is not None:
            self.links.append((self.href,' '.join(self.parts)));self.href=None;self.parts=[]

def candidate(url):
    try: p=urlsplit(html.unescape(url)); port=p.port
    except ValueError: return None
    if p.scheme!='https' or not p.hostname or p.username or p.password or port not in (None,443): return None
    host=p.hostname.lower().rstrip('.'); seg=[x for x in p.path.split('/') if x]; query=parse_qs(p.query)
    ats=token=None
    if (m:=WORKDAY.fullmatch(host)):
        if seg and LOCALE.fullmatch(seg[0]): seg=seg[1:]
        if not seg or seg[0].lower() in {'job', 'wday', 'auth'} or not TOKEN.fullmatch(seg[0]): return None
        return {'ats':'workday','tenant':m.group(1),'cluster':m.group(2),'board':seg[0],'board_url':f'https://{host}/{seg[0]}'}
    if host in {'jobs.smartrecruiters.com','careers.smartrecruiters.com'}:
        ats='smartrecruiters';token=seg[0] if seg else None
    elif host in {'job-boards.greenhouse.io','boards.greenhouse.io'}:
        ats='greenhouse';token=(query.get('for') or [None])[0] if seg and seg[0].lower()=='embed' else (seg[0] if seg else None)
    elif host=='boards-api.greenhouse.io' and len(seg)>=3 and seg[:2]==['v1','boards']:
        ats='greenhouse';token=seg[2]
    elif host=='jobs.ashbyhq.com': ats='ashby';token=seg[0] if seg else None
    elif host=='api.ashbyhq.com' and len(seg)>=3 and seg[:2]==['posting-api','job-board']: ats='ashby';token=seg[2]
    elif host=='jobs.lever.co': ats='lever';token=seg[0] if seg else None
    elif host=='api.lever.co' and len(seg)>=3 and seg[:2]==['v0','postings']: ats='lever';token=seg[2]
    if not ats or not token or not TOKEN.fullmatch(token) or token.lower() in SKIP: return None
    return {'ats':ats,'board':token,'board_url':url.split('?')[0]}

def belongs(url,domain):
    try: p=urlsplit(url);port=p.port
    except ValueError: return False
    host=(p.hostname or '').lower().rstrip('.')
    return p.scheme=='https' and not p.username and not p.password and port in (None,443) and (host==domain or host.endswith('.'+domain))

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl): return None

def public_host(host):
    # Do not let an input row or redirect cause access to local or private network addresses.
    infos=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
    return bool(infos) and all(ipaddress.ip_address(info[4][0]).is_global for info in infos)

def fetch(url,domain,timeout=12):
    opener=build_opener(NoRedirect()); current=url
    for _ in range(5):
        if not belongs(current,domain): return {'redirect':current}
        host=urlsplit(current).hostname
        if not public_host(host): raise ValueError('non-public hostname address')
        request=Request(current,headers={'User-Agent':UA,'Accept':'text/html,application/xhtml+xml'})
        try:
            with opener.open(request,timeout=timeout) as response:
                ctype=response.headers.get_content_type()
                if ctype not in ('text/html','application/xhtml+xml'): raise ValueError('not HTML')
                content=response.read(MAX_BYTES+1)
                if len(content)>MAX_BYTES: raise ValueError('response exceeded size bound')
                return {'url':current,'html':content.decode(response.headers.get_content_charset() or 'utf-8',errors='replace')}
        except HTTPError as error:
            if error.code not in (301,302,303,307,308) or not error.headers.get('Location'): raise
            current=urljoin(current,error.headers['Location'])
    raise ValueError('redirect limit exceeded')

def discover(row, fetcher=fetch, max_pages=5, delay=1.0):
    domain=row['domain'].strip().lower().rstrip('.')
    if not re.fullmatch(r'[a-z0-9.-]+',domain) or '.' not in domain or '..' in domain: raise ValueError('invalid company domain')
    queue=[f'https://{domain}/careers',f'https://careers.{domain}/',f'https://{domain}/']
    seen=set(); candidates={};errors=[]; pages=0
    while queue and pages<max_pages:
        url=queue.pop(0)
        if url in seen: continue
        seen.add(url);pages+=1
        try: response=fetcher(url,domain)
        except (OSError, ValueError, URLError, HTTPError) as error:
            errors.append({'url':url,'error':str(error)[:200]});
            if delay: time.sleep(delay)
            continue
        if response.get('redirect'):
            redirect=response['redirect']; found=candidate(redirect)
            if found: found['evidence_url']=url; candidates[(found['ats'],found.get('tenant',''),found['board'].lower())]=found
            else: errors.append({'url':url,'error':'redirected outside company domain'})
            if delay: time.sleep(delay)
            continue
        actual=response['url'];doc=response['html'];parser=Links();parser.feed(doc)
        urls=[(urljoin(actual,href),label) for href,label in parser.links if href]
        # First-party HTML also commonly embeds ATS URLs in script/config values.
        urls.extend((url,'') for url in URLS.findall(html.unescape(doc)))
        for link,label in urls:
            found=candidate(link)
            if found:
                found['evidence_url']=actual; candidates[(found['ats'],found.get('tenant',''),found['board'].lower())]=found
            elif belongs(link,domain) and CAREER.search(label+' '+urlsplit(link).path) and link not in seen and link not in queue: queue.append(link.split('#')[0])
        if delay: time.sleep(delay)
    status='candidates' if candidates else 'unresolved'
    reason='first-party linked candidates require API and ownership validation' if candidates else ('no first-party linked board detected' if pages>len(errors) else 'all bounded page attempts failed')
    return {'rank':row['rank'],'company':row['name'],'domain':domain,'status':status,'reason':reason,'pages_attempted':pages,'candidates':list(candidates.values()),'errors':errors}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);parser.add_argument('--limit',type=int,default=25);parser.add_argument('--pages',type=int,default=5);parser.add_argument('--delay',type=float,default=1.0);parser.add_argument('--retry-unresolved',action='store_true');args=parser.parse_args()
    if not 1<=args.limit<=500 or not 1<=args.pages<=10 or args.delay<0.5: parser.error('limit must be 1–500, pages 1–10, delay at least 0.5 seconds')
    path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True)
    previous={}
    if path.exists():
        lines=path.read_text().splitlines(keepends=True)
        valid=[]
        for index,line in enumerate(lines):
            try: row=json.loads(line)
            except json.JSONDecodeError:
                if index!=len(lines)-1: raise
                break
            previous[row['domain']]=row
            valid.append(line.rstrip('\n')+'\n')
        # Repair only a torn final append, keeping all complete checkpoints.
        repaired=''.join(valid)
        if repaired!=path.read_text(): path.write_text(repaired)
    with open(args.input,newline='') as f: rows=list(csv.DictReader(f))
    todo=[r for r in rows if r['domain'].lower() not in previous or (args.retry_unresolved and previous[r['domain'].lower()]['status']=='unresolved')][:args.limit]
    with path.open('a') as output:
        for row in todo:
            try: result=discover(row,max_pages=args.pages,delay=args.delay)
            except Exception as error: result={'rank':row.get('rank'),'company':row.get('name'),'domain':row.get('domain'),'status':'unresolved','reason':'discovery error: '+str(error)[:200],'candidates':[],'errors':[]}
            output.write(json.dumps(result,ensure_ascii=False)+'\n');output.flush()
            print(json.dumps({'rank':result['rank'],'domain':result['domain'],'status':result['status'],'candidate_count':len(result['candidates'])}),flush=True)
    print(json.dumps({'processed':len(todo),'remaining':sum(1 for r in rows if r['domain'].lower() not in previous)-len([r for r in todo if r['domain'].lower() not in previous])}),file=sys.stderr)
if __name__=='__main__':main()
