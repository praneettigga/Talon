"""Validate an AMLWorld dataset variant and write a source-bound manifest."""
import argparse
import csv
from collections import Counter
from datetime import datetime
from pathlib import Path

from pipeline.data import ACCOUNT_HEADER, DATASET, SUPPORTED, TX_HEADER, digest, transaction, write_manifest


def profile(directory, prefix):
    names = (f'{prefix}_Trans.csv', f'{prefix}_accounts.csv', f'{prefix}_Patterns.txt')
    paths = [directory / name for name in names]
    if not all(path.is_file() for path in paths):
        raise ValueError(f'Missing one or more {prefix} source files in {directory}')
    typologies, labels, first, last = Counter(), Counter(), None, None
    active = None
    with paths[2].open(encoding='utf-8-sig', newline='') as source:
        for line_number, line in enumerate(source, 1):
            line = line.strip()
            if not line:
                continue
            if line.startswith('BEGIN LAUNDERING ATTEMPT - '):
                if active is not None:
                    raise ValueError(f'{names[2]}:{line_number}: nested pattern attempt')
                active = line.split(' - ', 1)[1].split(':', 1)[0].strip()
            elif line.startswith('END LAUNDERING ATTEMPT - '):
                if active is None:
                    raise ValueError(f'{names[2]}:{line_number}: unmatched pattern end')
                typologies[active] += 1; active = None
            elif active is None:
                raise ValueError(f'{names[2]}:{line_number}: row outside pattern attempt')
    if active is not None or not typologies:
        raise ValueError(f'{names[2]}: incomplete or empty pattern file')
    stats = {}
    for name, path, expected in zip(names[:2], paths[:2], (TX_HEADER, ACCOUNT_HEADER)):
        count = 0
        with path.open(encoding='utf-8-sig', newline='') as source:
            reader = csv.reader(source, strict=True)
            if next(reader, None) != expected:
                raise ValueError(f'{name}: unexpected header')
            for count, row in enumerate(reader, 1):
                if name == names[0]:
                    stamp = transaction(row, f'{name}:{reader.line_num}')
                    first = stamp if first is None else min(first, stamp)
                    last = stamp if last is None else max(last, stamp)
                    labels[row[10]] += 1
                elif len(row) != len(expected) or any(not value.strip() for value in row):
                    raise ValueError(f'{name}:{reader.line_num}: invalid account row')
        stats[name] = {'rows': count, 'columns': expected, 'sha256': digest(path), 'bytes': path.stat().st_size}
    stats[names[2]] = {'attempts': sum(typologies.values()), 'sha256': digest(paths[2]), 'bytes': paths[2].stat().st_size}
    return {'schema_version': 1, 'dataset': f'IBM AMLWorld {prefix} synthetic AML benchmark',
            'source_url': f'https://www.kaggle.com/datasets/{DATASET}', 'license': 'CDLA-Sharing-1.0',
            'files': stats, 'typology_attempts': dict(sorted(typologies.items())),
            'enabled_typologies': sorted(SUPPORTED.intersection(typologies)),
            'unsupported_typologies': sorted(set(typologies) - SUPPORTED), 'labels': dict(sorted(labels.items())),
            'event_time_range': {'first': first.isoformat(), 'last': last.isoformat(), 'timezone': 'unspecified by source'},
            'account_age_available': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--prefix', required=True, choices=('HI-Medium', 'LI-Medium'))
    parser.add_argument('--manifest', type=Path, required=True)
    args = parser.parse_args()
    manifest = profile(args.data_dir, args.prefix)
    write_manifest(manifest, args.manifest)
    print(f"Validated {manifest['files'][f'{args.prefix}_Trans.csv']['rows']:,} transactions; manifest: {args.manifest}")


if __name__ == '__main__':
    main()
