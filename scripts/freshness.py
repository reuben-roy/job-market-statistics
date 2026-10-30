"""Conservatively label aggregate freshness when individual sources are stale."""
import datetime
import fcntl
import sqlite3


def source_freshness(path):
    """Oldest source success, or epoch when source freshness is unknown.

    Includes failed configured sources with no prior data, and retained sources no longer listed in
    the registry. A source with no recorded successful poll must not be advertised as fresh.
    """
    with open(str(path) + '.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        db = sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True)
        try:
            rows = db.execute('''select source,last_success_at from statistics_source_health
                union select p.source,NULL from postings p
                where not exists (select 1 from statistics_source_health h where h.source=p.source)
            ''').fetchall()
        finally:
            db.close()
    if not rows or any(ts is None for _, ts in rows):
        return datetime.datetime.fromtimestamp(0, datetime.timezone.utc).isoformat()
    return datetime.datetime.fromtimestamp(min(ts for _, ts in rows), datetime.timezone.utc).isoformat()
