"""Strictly labeled, replay-bound synthetic context, filtered by observation time."""
from collections import defaultdict
import csv
from datetime import datetime
import hashlib
import json
from pathlib import Path

from .engine import GRAPH_WINDOW, endpoints

LABEL = 'Synthetic Talon enrichment; not supplied by IBM AMLWorld'
HEADER = ['account_id', 'device_id', 'ip_cluster', 'location', 'first_seen', 'scenario']
SCENARIOS = {'individual context', 'shared-network control', 'shared-device demonstration'}


def unavailable(error='Synthetic context not prepared. Run npm run enrichment:prepare.'):
    return {'status': 'unavailable', 'error': error, 'label': LABEL, 'asOf': None,
            'usedInRiskModel': False, 'affectsSeverity': False, 'accounts': {}, 'links': []}


class Enrichment:
    def __init__(self, path, replay_sha, source_sha):
        if not replay_sha:
            raise ValueError('Synthetic context is not bound to this replay')
        path = Path(path)
        metadata = json.loads(path.with_suffix('.manifest.json').read_text())
        if metadata['schemaVersion'] != 1 or metadata['label'] != LABEL:
            raise ValueError('Unsupported synthetic context metadata')
        if metadata['replaySha256'] != replay_sha or metadata['sourceSha256'] != source_sha:
            raise ValueError('Synthetic context replay/source hash mismatch; run enrichment:prepare')
        if hashlib.sha256(path.read_bytes()).hexdigest() != metadata['csvSha256']:
            raise ValueError('Synthetic context CSV checksum mismatch')
        self.rows = []
        identities = set()
        with path.open(newline='') as source:
            reader = csv.DictReader(source)
            if reader.fieldnames != HEADER:
                raise ValueError('Synthetic context CSV schema changed')
            for row in reader:
                if set(row) != set(HEADER) or any(not value for value in row.values()):
                    raise ValueError('Incomplete synthetic context row')
                if row['scenario'] not in SCENARIOS:
                    raise ValueError('Unknown synthetic context scenario')
                parsed = datetime.fromisoformat(row['first_seen'])
                if parsed.tzinfo is not None or parsed.isoformat() != row['first_seen']:
                    raise ValueError('Synthetic timestamps must use source-compatible naive ISO format')
                key = (row['account_id'], row['first_seen'])
                if key in identities or row['account_id'] not in metadata['accountIds']:
                    raise ValueError('Duplicate or foreign synthetic context account')
                identities.add(key)
                self.rows.append({'accountId': row['account_id'], 'deviceId': row['device_id'],
                                  'ipCluster': row['ip_cluster'], 'location': row['location'],
                                  'firstSeen': row['first_seen'], 'scenario': row['scenario']})
                if len(self.rows) > 4000:
                    raise ValueError('Synthetic context exceeds bounded replay size')
        if len(self.rows) != metadata['rows'] or {r['accountId'] for r in self.rows} != set(metadata['accountIds']):
            raise ValueError('Synthetic context account/row coverage mismatch')
        self.rows.sort(key=lambda r: (r['firstSeen'], r['accountId']))

    def snapshot(self, events, findings):
        now = events[-1]['timestamp'] if events else None
        observed = {a for event in events for a in endpoints(event)}
        accounts = {row['accountId']: dict(row) for row in self.rows
                    if now and row['firstSeen'] <= now and row['accountId'] in observed}
        links = []
        for field in ['deviceId', 'ipCluster']:
            groups = defaultdict(list)
            for entity, row in accounts.items():
                groups[row[field]].append(entity)
            for value, ids in sorted(groups.items()):
                if len(ids) < 2:
                    continue
                ids.sort()
                supporting = []
                if field == 'deviceId':
                    supporting = sorted(f['id'] for f in findings.values()
                        if len(set(f['roles']) & set(ids)) >= 2 and
                        datetime.fromisoformat(now) - datetime.fromisoformat(f['window']['last']) <= GRAPH_WINDOW)
                identity = json.dumps([field, value, ids], separators=(',', ':'))
                links.append({'id': 'context-' + hashlib.sha256(identity.encode()).hexdigest()[:16],
                              'kind': 'device' if field == 'deviceId' else 'network', 'value': value,
                              'accountIds': ids, 'firstSeen': max(accounts[a]['firstSeen'] for a in ids),
                              'observedAt': now, 'supportingFindingIds': supporting,
                              'supportsStructure': bool(supporting),
                              'scenarios': sorted({accounts[a]['scenario'] for a in ids}),
                              'facts': [f'{len(ids)} observed accounts share synthetic {"device" if field == "deviceId" else "IP cluster"} {value}.',
                                        'Context only; sharing does not establish ownership, coordination, or fraud.']})
        return {'status': 'ready', 'error': None, 'label': LABEL, 'asOf': now,
                'usedInRiskModel': False, 'affectsSeverity': False, 'accounts': accounts, 'links': links}
