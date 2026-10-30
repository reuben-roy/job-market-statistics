"""Public aggregate collection coverage; never expose employer names or records."""
import datetime
import json
import os
import sqlite3

def build_coverage(state, databases, history_path):
    platforms = {}
    def add(platform, boards, postings, issues):
        item=platforms.setdefault(platform,{'platform':platform,'boards':0,'postings':0,'issues':0})
        item['boards']+=boards;item['postings']+=postings;item['issues']+=issues
    for source in state['sources']:
        add(source['source'].split(':')[0],1,source['open_postings'],int(bool(source.get('consecutive_failures') or source.get('suspect'))))
    for platform,path in databases:
        if not path.exists(): continue
        with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True) as db:
            count=db.execute('select count(distinct source),count(*) from postings where status="open"').fetchone()
            errors=db.execute('select count(*) from statistics_source_health where last_error is not null').fetchone()[0]
            add(platform,count[0],count[1],errors)
    today=datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    history=json.loads(history_path.read_text()) if history_path.exists() else []
    row={'date':today,'boards':sum(x['boards'] for x in platforms.values()),'postings':sum(x['postings'] for x in platforms.values())}
    history=[x for x in history if x['date']!=today]+[row];history=sorted(history,key=lambda x:x['date'])[-366:]
    temporary=history_path.with_suffix('.tmp');temporary.write_text(json.dumps(history));os.replace(temporary,history_path)
    return {'platforms':list(platforms.values()),'history':history}
