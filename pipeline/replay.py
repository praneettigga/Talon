"""Build a deterministic, bounded demonstration stream; never a benchmark split."""
import argparse
from bisect import bisect_left
import csv
from datetime import datetime, timedelta
import hashlib
import heapq
import json
from pathlib import Path
import sys

from .data import ROOT, FILES, TX_HEADER, DataError, digest, patterns, write_manifest


def select_attempts(path, enabled, selection='earliest'):
    if selection not in {'earliest', 'latest'}:
        raise DataError('Unsupported attempt selection policy')
    patterns(path)  # Validate structure before interpreting blocks.
    attempts = []
    with path.open(encoding='utf-8-sig') as source:
        for line in source:
            line = line.strip()
            if line.startswith('BEGIN LAUNDERING ATTEMPT - '):
                typology = line.split(' - ', 1)[1].split(':', 1)[0].strip()
                rows = []
            elif line.startswith('END LAUNDERING ATTEMPT - '):
                attempts.append({'id': len(attempts) + 1, 'typology': typology, 'rows': rows})
            elif line:
                rows.append(tuple(next(csv.reader([line]))))
    selected = []
    for typology in sorted(enabled):
        eligible = [a for a in attempts if a['typology'] == typology and len(a['rows']) <= 100]
        if not eligible:
            raise DataError(f'No complete {typology} attempt within the 100-row demo bound')
        choose = min if selection == 'earliest' else max
        selected.append(choose(eligible, key=lambda a: (min(r[0] for r in a['rows']), a['id'])))
    if not selected:
        raise DataError('No enabled typologies in the dataset manifest')
    return selected


def build(directory, manifest, context_limit=120, selection='earliest'):
    for name in FILES:
        if digest(directory / name) != manifest['files'][name]['sha256']:
            raise DataError(f'{name}: checksum differs from validated manifest; run data:profile')
    attempts = select_attempts(directory / FILES[2], manifest['enabled_typologies'], selection)
    wanted = {row for attempt in attempts for row in attempt['rows']}
    times = sorted({datetime.strptime(row[0], '%Y/%m/%d %H:%M') for row in wanted})
    # Lexicographic comparisons are valid for the fixed-width source timestamp.
    windows = [(t - timedelta(hours=1), t + timedelta(hours=1)) for t in times]
    ends = [end.strftime('%Y/%m/%d %H:%M') for _, end in windows]
    starts = [start.strftime('%Y/%m/%d %H:%M') for start, _ in windows]
    selected, found, context = [], set(), []
    with (directory / FILES[0]).open(encoding='utf-8-sig', newline='') as source:
        reader = csv.reader(source)
        if next(reader) != TX_HEADER:
            raise DataError('Transaction schema changed')
        for number, row in enumerate(reader, 1):
            key = tuple(row)
            if key in wanted:
                # Include every source occurrence instead of silently deduplicating.
                selected.append((number, row))
                found.add(key)
            elif row[10] == '0':
                index = bisect_left(ends, row[0])
                if index < len(starts) and starts[index] <= row[0]:
                    rank = int(hashlib.sha256(f'talon-replay-v1:{number}'.encode()).hexdigest(), 16)
                    heapq.heappush(context, (-rank, number, row))
                    if len(context) > context_limit:
                        heapq.heappop(context)
    if wanted != found:
        raise DataError('Selected pattern rows are missing from transaction source')
    if not context:
        raise DataError('No benign context found near selected pattern transactions')
    selected.extend((number, row) for _, number, row in context)
    selected.sort(key=lambda item: (item[1][0], item[0]))
    if len(selected) > 1000:
        raise DataError('Replay exceeds the 1,000-event limit')
    events = [
        {'id': f'hi-small:{number}', 'sourceRow': number,
         'timestamp': row[0].replace('/', '-').replace(' ', 'T') + ':00',
         'fromBank': row[1], 'fromAccount': row[2], 'toBank': row[3], 'toAccount': row[4],
         'amountReceived': row[5], 'receivingCurrency': row[6],
         'amountPaid': row[7], 'paymentCurrency': row[8], 'paymentFormat': row[9]}
        for number, row in selected
    ]
    payload = {'schemaVersion': 1, 'dataset': manifest['dataset'],
               'sourceSha256': manifest['files'][FILES[0]]['sha256'], 'events': events}
    provenance = {
        'selection_version': 1, 'purpose': 'Curated demonstration; not an evaluation dataset',
        'policy': f'{selection.capitalize()} complete attempt (at most 100 rows) per enabled typology; '
                  '120 lowest SHA-256 ranks of benign source rows within one hour of selected events',
        'context_rows': len(context), 'source_files': manifest['files'],
        'attempts': [{'id': a['id'], 'typology': a['typology'],
                      'transaction_ids': [f'hi-small:{n}' for n, r in selected if tuple(r) in a['rows']]}
                     for a in attempts],
        'source_header': TX_HEADER,
        'source_rows': [{'source_row': number, 'fields': row} for number, row in selected],
    }
    return payload, provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data/raw/amlworld')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'docs/data/hi-small-manifest.json')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data/replay')
    args = parser.parse_args()
    try:
        payload, provenance = build(args.data_dir, json.loads(args.manifest.read_text()))
        write_manifest(provenance, args.output_dir / 'provenance.json')
        write_manifest(payload, args.output_dir / 'replay.json')
        print(f'Prepared {len(payload["events"])} events from {len(provenance["attempts"])} complete attempts '
              f'and {provenance["context_rows"]} benign context rows in {args.output_dir}')
        return 0
    except (OSError, ValueError, KeyError, DataError) as error:
        print(f'Replay preparation failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
