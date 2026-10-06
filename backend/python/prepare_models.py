"""Bounded model dataset; labels/provenance are isolated from inference artifacts."""
import argparse
from collections import Counter
import csv
from datetime import datetime, timedelta
import hashlib
import heapq
import json
from pathlib import Path

from pipeline.data import ROOT, FILES, TX_HEADER, digest, write_manifest
from .engine import account


def event_from_row(number, row):
    return {'id': f'hi-small:{number}', 'sourceRow': number,
            'timestamp': row[0].replace('/', '-').replace(' ', 'T') + ':00',
            'fromBank': row[1], 'fromAccount': row[2], 'toBank': row[3], 'toAccount': row[4],
            'amountReceived': row[5], 'receivingCurrency': row[6], 'amountPaid': row[7],
            'paymentCurrency': row[8], 'paymentFormat': row[9]}


def build(directory, manifest, days=10, related_limit=6000, global_limit=2000):
    for name in FILES:
        if digest(directory / name) != manifest['files'][name]['sha256']:
            raise ValueError(f'{name}: checksum differs from validated source')
    start = datetime.fromisoformat(manifest['event_time_range']['first'])
    end = min(start + timedelta(days=days), datetime.fromisoformat(manifest['event_time_range']['last']))
    boundary = end.strftime('%Y/%m/%d %H:%M')
    patterns = set()
    for line in (directory / FILES[2]).read_text().splitlines():
        if line and not line.startswith(('BEGIN', 'END')):
            row = next(csv.reader([line]))
            patterns.update((account(row[1], row[2]), account(row[3], row[4])))
    # Fixed observed-control population, selected without laundering labels beyond
    # requiring the seed rows to be benign. Retain repeated benign-account histories.
    controls = Counter()
    with (directory / FILES[0]).open(newline='') as source:
        reader = csv.reader(source); next(reader)
        for n, row in enumerate(reader):
            if n == 20000:
                break
            if row[10] == '0':
                controls.update((account(row[1], row[2]), account(row[3], row[4])))
    controls = {key for key, _ in sorted(controls.items(), key=lambda x: (-x[1], x[0]))[:32]}
    related_accounts = patterns | controls
    selected, related, context = [], [], []
    with (directory / FILES[0]).open(newline='') as source:
        reader = csv.reader(source)
        if next(reader) != TX_HEADER:
            raise ValueError('Transaction schema changed')
        for number, row in enumerate(reader, 1):
            if row[0] >= boundary:
                continue
            if row[10] == '1':
                selected.append((number, row))  # Includes RANDOM and ungrouped positives.
                continue
            rank = int(hashlib.sha256(f'talon-model-v1:{number}'.encode()).hexdigest(), 16)
            peers = {account(row[1], row[2]), account(row[3], row[4])}
            if peers & related_accounts:
                heapq.heappush(related, (-rank, number, row))
                if len(related) > related_limit:
                    heapq.heappop(related)
            heapq.heappush(context, (-rank, number, row))
            if len(context) > global_limit:
                heapq.heappop(context)
    selected = {n: row for n, row in selected + [(n, row) for _, n, row in related + context]}
    rows = sorted(selected.items(), key=lambda p: (p[1][0], p[0]))
    events = [event_from_row(n, row) for n, row in rows]
    labels = {f'hi-small:{n}': int(row[10]) for n, row in rows}
    split = {name: (start + (end - start) * fraction).isoformat()
             for name, fraction in [('trainEnd', .6), ('validationEnd', .8), ('end', 1)]}
    metadata = {'schemaVersion': 1, 'dataset': manifest['dataset'],
                'sourceSha256': manifest['files'][FILES[0]]['sha256'], 'start': start.isoformat(),
                'split': split, 'rows': len(events), 'positives': sum(labels.values()),
                'selection': f'First {days} days; all labelled positives, {related_limit} lowest-hash benign rows touching pattern/control accounts, '
                             f'{global_limit} lowest-hash global benign rows; seed control population: top 32 accounts among benign rows in first 20000 source rows.',
                'limitation': 'Case-enriched bounded synthetic subset; metrics are not full HI-Small estimates.'}
    return events, labels, metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data/raw/amlworld')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data/models/dataset')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'docs/data/hi-small-manifest.json').read_text())
    events, labels, metadata = build(args.data_dir, manifest)
    write_manifest({'events': events, 'metadata': metadata}, args.output_dir / 'events.json')
    write_manifest(labels, args.output_dir / 'labels.json')
    print(f'Prepared {len(events)} modeling events ({sum(labels.values())} positives); split {metadata["split"]}')


if __name__ == '__main__':
    main()
