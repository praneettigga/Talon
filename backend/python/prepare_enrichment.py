"""Deterministic synthetic controls from observed replay prefixes; no ground truth read."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import tempfile

from pipeline.data import ROOT, write_manifest
from .engine import Engine, endpoints
from .enrichment import HEADER, LABEL


def generate(events, enabled):
    engine = Engine(enabled)
    rows, seen, controls = [], set(), []
    device_pair = None
    for event in events:
        for entity in sorted(set(endpoints(event))):
            if entity in seen:
                continue
            seen.add(entity)
            tag = hashlib.sha256(entity.encode()).hexdigest()[:12]
            control = len(controls) < 2
            if control:
                controls.append(entity)
            rows.append({'account_id': entity, 'device_id': 'talon-device-' + tag,
                         'ip_cluster': 'talon-network-control' if control else 'talon-network-' + tag,
                         'location': 'Talon synthetic location A' if control else 'Talon synthetic location B',
                         'first_seen': event['timestamp'],
                         'scenario': 'shared-network control' if control else 'individual context'})
        engine.process(event)
        if device_pair is None:
            for finding in sorted(engine.findings.values(), key=lambda f: f['id']):
                eligible = sorted((a for a in finding['roles'] if a not in controls),
                                  key=lambda a: (finding['roles'][a] != 'intermediary', a))
                if len(eligible) >= 2:
                    device_pair = eligible[:2]
                    for entity in device_pair:
                        rows.append({'account_id': entity, 'device_id': 'talon-device-demonstration',
                                     'ip_cluster': 'talon-network-demonstration', 'location': 'Talon synthetic location C',
                                     'first_seen': event['timestamp'], 'scenario': 'shared-device demonstration'})
                    break
    rows.sort(key=lambda r: (r['first_seen'], r['account_id']))
    return rows, controls, device_pair


def prepare(replay_path, output_path):
    replay_bytes = replay_path.read_bytes()
    replay = json.loads(replay_bytes)
    manifest = json.loads((ROOT / 'docs/data/hi-small-manifest.json').read_text())
    if replay['sourceSha256'] != manifest['files']['HI-Small_Trans.csv']['sha256']:
        raise ValueError('Replay source differs from validated dataset')
    rows, controls, pair = generate(replay['events'], manifest['enabled_typologies'])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', newline='', dir=output_path.parent, delete=False) as target:
        staged = Path(target.name)
        writer = csv.DictWriter(target, fieldnames=HEADER, lineterminator='\n')
        writer.writeheader(); writer.writerows(rows)
    staged.replace(output_path)
    metadata = {'schemaVersion': 1, 'label': LABEL, 'rows': len(rows),
                'accountIds': sorted({r['account_id'] for r in rows}),
                'replaySha256': hashlib.sha256(replay_bytes).hexdigest(), 'sourceSha256': replay['sourceSha256'],
                'csvSha256': hashlib.sha256(output_path.read_bytes()).hexdigest(),
                'policy': 'First two observed accounts share a control IP cluster with distinct devices. After the first supported finding with two non-control structural-role accounts, those accounts share a demonstration device/network from that observation time onward. All other contexts are individual deterministic IDs.',
                'controlAccountIds': controls, 'demonstrationAccountIds': pair or [],
                'usedInRiskModel': False, 'affectsSeverity': False}
    write_manifest(metadata, output_path.with_suffix('.manifest.json'))
    print(f'Prepared {len(rows)} synthetic context rows for {len(metadata["accountIds"])} replay accounts; demonstration pair: {pair or "unavailable"}')
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--replay-file', type=Path, default=ROOT / 'data/replay/replay.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/replay/talon_device_context.csv')
    args = parser.parse_args()
    prepare(args.replay_file, args.output)


if __name__ == '__main__':
    main()
