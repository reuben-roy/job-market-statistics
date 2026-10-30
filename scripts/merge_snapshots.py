"""Combine disjoint statistics buckets without receiving individual job records."""
import datetime
import json

MAX_BYTES = 5_000_000
MAX_GROUPS = 15_000
KEYS = ('role', 'country', 'industry', 'status', 'published_on')
SECTIONS = ('required', 'preferred', 'responsibilities')


def merge_snapshots(snapshots):
    if not snapshots:
        raise ValueError('At least one snapshot is required')
    first = snapshots[0]
    groups = {}
    timestamps = []
    for snapshot in snapshots:
        if any(snapshot[key] != first[key] for key in ('schema_version', 'vocabulary_version', 'source')):
            raise ValueError('Incompatible snapshot')
        timestamp = datetime.datetime.fromisoformat(snapshot['generated_at'].replace('Z', '+00:00'))
        if timestamp.tzinfo is None: raise ValueError('Snapshot timestamp must include timezone')
        timestamps.append(timestamp)
        for group in snapshot['groups']:
            key = tuple(group[name] for name in KEYS)
            if key not in groups:
                groups[key] = {**dict(zip(KEYS, key)), 'postings': 0, 'classified': 0,
                    'with_skills': 0, 'skills': {}, 'sections': {s: {} for s in SECTIONS},
                    'salary': {'count': 0, 'min_sum': 0, 'max_sum': 0}}
            target = groups[key]
            if first['schema_version'] >= 4:
                target.setdefault('patterns', {})
                for signature, count in group['patterns'].items():
                    target['patterns'][signature] = target['patterns'].get(signature, 0) + count
            for name in ('postings', 'classified', 'with_skills'):
                target[name] += group[name]
            for name, count in group['skills'].items():
                target['skills'][name] = target['skills'].get(name, 0) + count
            for section in SECTIONS:
                for name, count in group['sections'][section].items():
                    target['sections'][section][name] = target['sections'][section].get(name, 0) + count
            for name in ('count', 'min_sum', 'max_sum'):
                target['salary'][name] += group['salary'][name]
    if len(groups) > MAX_GROUPS: raise ValueError('Snapshot exceeds dashboard group limit')
    result = {**first, 'generated_at': min(timestamps).isoformat(), 'groups': list(groups.values())}
    data = json.dumps(result, separators=(',', ':')).encode()
    if len(data) > MAX_BYTES: raise ValueError('Snapshot exceeds dashboard size limit')
    return result, data
