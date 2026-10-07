"""Prepare a bounded Talon replay from an uploaded AMLWorld HI dataset."""
import argparse
from bisect import bisect_left
import csv
from datetime import datetime, timedelta
import hashlib
import heapq
import json
from pathlib import Path
import sys

from pipeline.data import ROOT, SUPPORTED, TX_HEADER, DataError, transaction


def matching_model(source_sha, enabled):
    # Only locally trained artifacts are eligible; filenames never establish identity.
    candidates = sorted((ROOT / 'data/models').glob('*/metadata.json'),
                        key=lambda path: (path.parent.name != 'current', path.parent.name))
    for path in candidates:
        if path.parent.name.endswith('-previous'):
            continue
        metadata = json.loads(path.read_text())
        if metadata.get('sourceSha256') == source_sha and metadata.get('enabledTypologies') == enabled:
            return path.parent, metadata['availableFrom']
    raise DataError('No trained model matches this uploaded dataset. Prepare and train models for this source before running scored analysis.')


def attempts(path):
    result, active, rows = [], None, []
    with path.open(encoding='utf-8-sig', newline='') as source:
        for line_number, line in enumerate(source, 1):
            line = line.strip()
            if not line:
                continue
            if line.startswith('BEGIN LAUNDERING ATTEMPT - '):
                if active is not None:
                    raise DataError(f'{path.name}:{line_number}: nested laundering attempt')
                active = line.split(' - ', 1)[1].split(':', 1)[0].strip()
                rows = []
            elif line.startswith('END LAUNDERING ATTEMPT - '):
                if active is None or not rows:
                    raise DataError(f'{path.name}:{line_number}: invalid laundering attempt')
                result.append((active, rows))
                active, rows = None, []
            else:
                if active is None:
                    raise DataError(f'{path.name}:{line_number}: row outside laundering attempt')
                row = next(csv.reader([line], strict=True))
                transaction(row, f'{path.name}:{line_number}')
                rows.append(tuple(row))
    if active is not None:
        raise DataError(f'{path.name}: unterminated laundering attempt')
    return result


def build(directory):
    files = list(directory.iterdir())
    transaction_file = next((p for p in files if p.name in {'HI-Small_Trans.csv', 'HI-Medium_Trans.csv'}), None)
    patterns_file = next((p for p in files if p.name in {'HI-Small_Patterns.txt', 'HI-Medium_Patterns.txt'}), None)
    accounts_file = next((p for p in files if p.name in {'HI-Small_accounts.csv', 'HI-Medium_accounts.csv'}), None)
    if not transaction_file or not patterns_file or not accounts_file:
        raise DataError('Upload the matching HI-Small or HI-Medium Trans CSV, accounts CSV, and Patterns TXT files.')
    size = 'HI-Medium' if transaction_file.name.startswith('HI-Medium') else 'HI-Small'
    if patterns_file.name != f'{size}_Patterns.txt' or accounts_file.name != f'{size}_accounts.csv':
        raise DataError('The transaction, accounts, and patterns files must be from the same HI dataset size.')
    all_attempts = attempts(patterns_file)
    enabled = sorted({kind for kind, _ in all_attempts if kind in SUPPORTED})
    with transaction_file.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    models_directory, available_from = matching_model(digest, enabled)
    cutoff = available_from.replace('-', '/').replace('T', ' ')[:16]
    chosen = []
    for kind in enabled:
        eligible = [rows for name, rows in all_attempts if name == kind and len(rows) <= 100
                    and min(row[0] for row in rows) >= cutoff]
        if eligible:
            chosen.append(max(eligible, key=lambda rows: min(row[0] for row in rows)))
    wanted = {row for rows in chosen for row in rows}
    if not wanted:
        raise DataError('No bounded supported laundering attempts were found in the uploaded patterns file.')
    times = sorted({datetime.strptime(row[0], '%Y/%m/%d %H:%M') for row in wanted})
    starts = [(time - timedelta(hours=1)).strftime('%Y/%m/%d %H:%M') for time in times]
    ends = [(time + timedelta(hours=1)).strftime('%Y/%m/%d %H:%M') for time in times]
    selected, found, context = [], set(), []
    with transaction_file.open(encoding='utf-8-sig', newline='') as source:
        reader = csv.reader(source)
        if next(reader, None) != TX_HEADER:
            raise DataError(f'{transaction_file.name}: unexpected transaction schema')
        for number, row in enumerate(reader, 1):
            key = tuple(row)
            if key in wanted:
                selected.append((number, row)); found.add(key)
            elif len(row) == 11 and row[10] == '0' and row[0] >= cutoff:
                index = bisect_left(ends, row[0])
                if index < len(starts) and starts[index] <= row[0]:
                    rank = int(hashlib.sha256(f'talon-upload-v1:{number}'.encode()).hexdigest(), 16)
                    heapq.heappush(context, (-rank, number, row))
                    if len(context) > 120:
                        heapq.heappop(context)
    if wanted != found:
        raise DataError('Selected laundering rows were not found in the uploaded transaction CSV.')
    selected.extend((number, row) for _, number, row in context)
    selected.sort(key=lambda item: (item[1][0], item[0]))
    prefix = size.lower().replace('-', '')
    events = [{'id': f'{prefix}:{number}', 'sourceRow': number,
               'timestamp': row[0].replace('/', '-').replace(' ', 'T') + ':00',
               'fromBank': row[1], 'fromAccount': row[2], 'toBank': row[3], 'toAccount': row[4],
               'amountReceived': row[5], 'receivingCurrency': row[6], 'amountPaid': row[7],
               'paymentCurrency': row[8], 'paymentFormat': row[9]} for number, row in selected]
    return {'schemaVersion': 1, 'dataset': f'IBM AMLWorld {size} uploaded dataset',
            'sourceSha256': digest, 'events': events, 'enabledTypologies': enabled,
            'modelsDirectory': str(models_directory),
            'uploadedFiles': [path.name for path in files]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.directory), separators=(',', ':')))
        return 0
    except (OSError, ValueError, KeyError, DataError, csv.Error) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
