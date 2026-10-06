"""Download and strictly profile IBM HI-Small without loading its CSV into memory."""
import argparse
from collections import Counter
import csv
from datetime import datetime
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DATASET = 'ealtman2019/ibm-transactions-for-anti-money-laundering-aml'
FILES = ('HI-Small_Trans.csv', 'HI-Small_accounts.csv', 'HI-Small_Patterns.txt')
TX_HEADER = ['Timestamp', 'From Bank', 'Account', 'To Bank', 'Account',
             'Amount Received', 'Receiving Currency', 'Amount Paid',
             'Payment Currency', 'Payment Format', 'Is Laundering']
ACCOUNT_HEADER = ['Bank Name', 'Bank ID', 'Account Number', 'Entity ID', 'Entity Name']
SUPPORTED = {'FAN-IN', 'FAN-OUT', 'GATHER-SCATTER', 'SCATTER-GATHER', 'CYCLE', 'BIPARTITE', 'STACK'}


class DataError(Exception):
    pass


def transaction(row, location):
    if len(row) != 11 or any(not field.strip() for field in row):
        raise DataError(f'{location}: expected 11 nonempty transaction fields')
    try:
        stamp = datetime.strptime(row[0], '%Y/%m/%d %H:%M')
        for index in (5, 7):
            amount = Decimal(row[index])
            if not amount.is_finite() or amount < 0:
                raise ValueError('invalid amount')
        if row[10] not in ('0', '1'):
            raise ValueError('invalid laundering label')
    except (ValueError, InvalidOperation) as error:
        raise DataError(f'{location}: invalid timestamp, amount, or binary label') from error
    return stamp


def patterns(path):
    counts, keys = Counter(), set()
    active, rows = None, 0
    total = 0
    with path.open(encoding='utf-8-sig', newline='') as source:
        for line_number, line in enumerate(source, 1):
            line = line.strip()
            if not line:
                continue
            location = f'{path.name}:{line_number}'
            if line.startswith('BEGIN LAUNDERING ATTEMPT - '):
                if active is not None:
                    raise DataError(f'{location}: nested pattern attempt')
                active = line.split(' - ', 1)[1].split(':', 1)[0].strip()
                if not active:
                    raise DataError(f'{location}: missing typology')
                rows = 0
            elif line.startswith('END LAUNDERING ATTEMPT - '):
                ending = line.split(' - ', 1)[1].split(':', 1)[0].strip()
                if active is None or ending != active or rows == 0:
                    raise DataError(f'{location}: unmatched, mismatched, or empty pattern attempt')
                counts[active] += 1
                active = None
            else:
                if active is None:
                    raise DataError(f'{location}: row outside a pattern attempt')
                row = next(csv.reader([line], strict=True))
                transaction(row, location)
                if row[10] != '1':
                    raise DataError(f'{location}: pattern transaction is not labelled laundering')
                keys.add(tuple(row))
                rows += 1
                total += 1
    if active is not None or not counts:
        raise DataError(f'{path.name}: unterminated or empty patterns file')
    return dict(sorted(counts.items())), keys, total


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def profile(directory):
    for name in FILES:
        if not (directory / name).is_file():
            raise DataError(f'Missing {name} in {directory}; run npm run data:download')
    typologies, unmatched, pattern_rows = patterns(directory / FILES[2])
    unique_pattern_rows = len(unmatched)
    file_stats = {}
    labels = Counter()
    first = last = None
    for name, expected in zip(FILES[:2], (TX_HEADER, ACCOUNT_HEADER)):
        count = 0
        with (directory / name).open(encoding='utf-8-sig', newline='') as source:
            reader = csv.reader(source, strict=True)
            header = next(reader, None)
            # Duplicate Account columns are meaningful; validate them positionally.
            if header != expected:
                raise DataError(f'{name}: unexpected header. Expected {expected!r}; got {header!r}')
            for count, row in enumerate(reader, 1):
                location = f'{name}:{reader.line_num}'
                if name == FILES[0]:
                    stamp = transaction(row, location)
                    first = stamp if first is None else min(first, stamp)
                    last = stamp if last is None else max(last, stamp)
                    labels[row[10]] += 1
                    unmatched.discard(tuple(row))
                elif len(row) != len(expected) or any(not value.strip() for value in row):
                    raise DataError(f'{location}: expected five nonempty account fields')
        if count == 0:
            raise DataError(f'{name}: no data rows')
        file_stats[name] = {'rows': count, 'columns': header}
    if unmatched:
        raise DataError(f'{len(unmatched)} pattern transactions do not match source transaction rows')
    file_stats[FILES[2]] = {'attempts': sum(typologies.values()), 'transaction_rows': pattern_rows,
                          'unique_transaction_rows': unique_pattern_rows}
    for name in FILES:
        file_stats[name].update(sha256=digest(directory / name), bytes=(directory / name).stat().st_size)
    return {
        'schema_version': 1,
        'dataset': 'IBM AMLWorld HI-Small synthetic AML benchmark',
        'source_url': f'https://www.kaggle.com/datasets/{DATASET}',
        'license': 'CDLA-Sharing-1.0', 'files': file_stats,
        'typology_attempts': typologies,
        'enabled_typologies': sorted(SUPPORTED.intersection(typologies)),
        'unsupported_typologies': sorted(set(typologies) - SUPPORTED),
        'labels': dict(sorted(labels.items())),
        'event_time_range': {'first': first.isoformat(), 'last': last.isoformat(),
                             'timezone': 'unspecified by source'},
        'account_age_available': False,
    }


def download(directory):
    if not all(os.environ.get(key, '').strip() for key in ('KAGGLE_USERNAME', 'KAGGLE_KEY')):
        raise DataError('Export KAGGLE_USERNAME and KAGGLE_KEY (Legacy API Credentials from Kaggle Settings > API); credentials are never read from repository files.')
    executable = ROOT / '.venv' / 'bin' / 'kaggle'
    command = str(executable) if executable.is_file() else shutil.which('kaggle')
    if not command:
        raise DataError('Kaggle CLI missing. Run python -m venv .venv then .venv/bin/python -m pip install -r pipeline/requirements.txt')
    directory.mkdir(parents=True, exist_ok=True)
    # Stage all files and validate before publishing. Never extract archive paths.
    with tempfile.TemporaryDirectory(prefix='.download-', dir=directory) as staging:
        environment = os.environ.copy()
        environment['KAGGLE_CONFIG_DIR'] = str(Path(staging) / '.kaggle')
        environment.pop('KAGGLE_API_TOKEN', None)
        for name in FILES:
            print(f'Downloading {name}…', flush=True)
            result = subprocess.run([command, 'datasets', 'download', DATASET,
                                     '-f', name, '-p', staging, '--unzip'],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    env=environment, timeout=1800)
            if result.returncode:
                raise DataError(f'Kaggle download failed for {name}; check credentials, dataset access/terms, and network. No staged files were published.')
            unpack_download(Path(staging), name)
        print('Validating downloaded files…', flush=True)
        profile(Path(staging))
        for name in FILES:
            os.replace(Path(staging) / name, directory / name)


def unpack_download(directory, name):
    target = directory / name
    if target.is_file():
        return
    archive = directory / (name + '.zip')
    if not archive.is_file():
        raise DataError(f'Kaggle did not return {name} or {name}.zip')
    try:
        with zipfile.ZipFile(archive) as source:
            if source.namelist() != [name]:
                raise DataError(f'{archive.name}: expected exactly the requested file')
            with source.open(name) as incoming, target.open('wb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)
    except zipfile.BadZipFile as error:
        raise DataError(f'{archive.name}: corrupt download archive') from error
    archive.unlink()


def write_manifest(manifest, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=output.parent, delete=False, encoding='utf-8') as temporary:
        path = Path(temporary.name)
        try:
            json.dump(manifest, temporary, indent=2, sort_keys=True)
            temporary.write('\n')
        except BaseException:
            path.unlink(missing_ok=True)
            raise
    try:
        os.replace(path, output)
    finally:
        path.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['download', 'profile', 'setup'])
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data/raw/amlworld')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'docs/data/hi-small-manifest.json')
    args = parser.parse_args(argv)
    try:
        if args.command in ('download', 'setup'):
            download(args.data_dir)
        if args.command in ('profile', 'setup'):
            manifest = profile(args.data_dir)
            write_manifest(manifest, args.manifest)
            print(f'Validated {manifest["files"][FILES[0]]["rows"]:,} transactions; manifest: {args.manifest}')
            print('Enabled typologies: ' + ', '.join(manifest['enabled_typologies']))
        return 0
    except subprocess.TimeoutExpired:
        print('Data setup failed: Kaggle download timed out after 30 minutes; retry setup.', file=sys.stderr)
        return 1
    except (DataError, OSError, csv.Error, UnicodeError) as error:
        print(f'Data setup failed: {error}', file=sys.stderr)
        return 1
