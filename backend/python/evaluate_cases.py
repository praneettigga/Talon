"""Frozen temporal case reconstruction; ground truth stays offline."""
import argparse
from collections import defaultdict, deque
from copy import deepcopy
import csv
import hashlib
import json
from pathlib import Path

from pipeline.data import ROOT, FILES, digest, write_manifest
from .engine import Engine, endpoints
from .prepare_models import event_from_row


class EvaluationEngine(Engine):
    """Skip unchanged findings offline; use the same detector and case transitions.

    Only a new transfer can grow a finding. Expiry alone is ignored by Engine.process.
    Models are deliberately absent: this evaluates structural reconstruction only.
    """
    def detect(self, edges, current):
        # A new finding must be connected to the new transfer. Unrelated active
        # components can only retain/shrink evidence, which process ignores.
        incident = defaultdict(list)
        pairs = []
        for index, edge in enumerate(edges):
            pair = endpoints(edge)
            pairs.append(pair)
            for entity in set(pair):
                incident[entity].append(index)
        seen = set(endpoints(current))
        queue = deque(sorted(seen))
        selected = set()
        while queue:
            for index in incident[queue.popleft()]:
                selected.add(index)
                for entity in pairs[index]:
                    if entity not in seen:
                        seen.add(entity); queue.append(entity)
        return super().detect([edges[i] for i in sorted(selected)], current, incremental=True)

    def process(self, event, *, emit_snapshot=True):
        # Reconstruction has no learned decisions to make. Reuse live finding and
        # correlation code, omitting unrelated feature/model/risk aggregation work.
        if self.events and (event['timestamp'], event['sourceRow']) <= (self.events[-1]['timestamp'], self.events[-1]['sourceRow']):
            raise ValueError('Events must arrive in strict timestamp/source-row order')
        if any(e['id'] == event['id'] for e in self.events):
            raise ValueError('Duplicate event ID')
        self.events.append(deepcopy(event))
        self.observe_structures(event)
        for case in self.cases:
            self.refresh_severity(case, event['timestamp'])
        return self.snapshot() if emit_snapshot else None


def match_cases(detected, truth):
    """Maximum-cardinality one-to-one overlap, then maximum total Jaccard.

    Sorting fixes input order. No threshold is selected on test data: any nonempty
    overlap qualifies, as specified by the plan. Duplicate cases cannot increase TP.
    """
    import numpy as np
    from scipy.optimize import linear_sum_assignment
    detected = sorted(detected, key=lambda x: x['id'])
    truth = sorted(truth, key=lambda x: x['id'])
    weights = np.zeros((len(detected), len(truth)))
    bonus = min(len(detected), len(truth)) + 1
    for i, case in enumerate(detected):
        a = set(case['transactionIds'])
        for j, attempt in enumerate(truth):
            b = set(attempt['transactionIds'])
            if a & b:
                weights[i, j] = bonus + len(a & b) / len(a | b)
    pairs = []
    if weights.size:
        rows, columns = linear_sum_assignment(weights, maximize=True)
        for i, j in zip(rows.tolist(), columns.tolist()):
            if weights[i, j] > 0:
                a, b = set(detected[i]['transactionIds']), set(truth[j]['transactionIds'])
                pairs.append({'caseId': detected[i]['id'], 'attemptId': truth[j]['id'],
                              'typology': truth[j]['typology'], 'overlap': len(a & b),
                              'caseTransactions': len(a), 'attemptTransactions': len(b),
                              'jaccard': len(a & b) / len(a | b)})
    tp = len(pairs)
    matched_cases = {p['caseId'] for p in pairs}
    matched_truth = {p['attemptId'] for p in pairs}
    return {'detectedCases': len(detected), 'groundTruthAttempts': len(truth), 'matched': tp,
            'unmatchedDetected': len(detected) - tp, 'missedAttempts': len(truth) - tp,
            'precision': tp / len(detected) if detected else None,
            'recall': tp / len(truth) if truth else None,
            'meanMatchedJaccard': sum(p['jaccard'] for p in pairs) / tp if tp else None,
            'matches': pairs,
            'unmatchedCaseIds': [c['id'] for c in detected if c['id'] not in matched_cases],
            'missedAttemptIds': [a['id'] for a in truth if a['id'] not in matched_truth]}


def ground_truth(directory, manifest, events=None):
    for name in FILES:
        if digest(directory / name) != manifest['files'][name]['sha256']:
            raise ValueError(f'{name}: checksum differs from validated source')
    attempts, owners = [], defaultdict(list)
    for line in (directory / FILES[2]).read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if line.startswith('BEGIN LAUNDERING ATTEMPT - '):
            attempt = {'id': f'attempt:{len(attempts) + 1:04d}',
                       'typology': line.split(' - ', 1)[1].split(':', 1)[0].strip(),
                       'transactionIds': [], 'times': [], 'patternRows': 0}
        elif line.startswith('END LAUNDERING ATTEMPT - '):
            attempts.append(attempt)
        elif line:
            row = tuple(next(csv.reader([line])))
            owners[row].append(attempt)
            attempt['patternRows'] += 1
            attempt['times'].append(row[0].replace('/', '-').replace(' ', 'T') + ':00')
    found = set()
    expected = {e['sourceRow']: e for e in events or []}
    verified = set()
    with (directory / FILES[0]).open(encoding='utf-8-sig', newline='') as source:
        reader = csv.reader(source); next(reader)
        for number, row in enumerate(reader, 1):
            if number in expected:
                if event_from_row(number, row) != expected[number]:
                    raise ValueError('Evaluation event differs from validated source row')
                verified.add(number)
            key = tuple(row)
            if key in owners:
                found.add(key)
                for attempt in owners[key]:
                    attempt['transactionIds'].append(f'hi-small:{number}')
    if found != set(owners):
        raise ValueError('Pattern transactions missing from source')
    if verified != set(expected):
        raise ValueError('Evaluation source rows missing')
    return attempts


def evaluate(cases, attempts, events, enabled, start, end):
    event_ids = {e['id'] for e in events}
    test_ids = {e['id'] for e in events if start <= e['timestamp'] < end}
    eligible, excluded = [], []
    for attempt in attempts:
        projected = sorted(set(attempt['transactionIds']) & test_ids)
        if not projected:
            continue
        if attempt['typology'] not in enabled:
            excluded.append({**attempt, 'reason': 'Unsupported typology'})
        elif not set(attempt['transactionIds']) <= event_ids or max(attempt['times']) >= end:
            excluded.append({**attempt, 'reason': 'Incomplete at evaluation boundary or subset'})
        else:
            eligible.append({'id': attempt['id'], 'typology': attempt['typology'], 'transactionIds': projected})
    # Excluded campaign transfers cannot count as named-rule false positives.
    eligible_ids = {t for a in eligible for t in a['transactionIds']}
    excluded_ids = ({t for a in excluded for t in a['transactionIds']} & test_ids) - eligible_ids
    metric_ids = test_ids - excluded_ids
    projected_cases = [{'id': c['id'], 'transactionIds': sorted(set(c['transactionIds']) & metric_ids)}
                       for c in cases if set(c['transactionIds']) & metric_ids]
    overall = match_cases(projected_cases, eligible)
    grouped = {}
    for typology in sorted(enabled):
        detected = []
        for case in cases:
            ids = {t for f in case['evidence'] if f['typology'] == typology for t in f['transactionIds']} & metric_ids
            if ids:
                detected.append({'id': case['id'], 'transactionIds': sorted(ids)})
        grouped[typology] = match_cases(detected, [a for a in eligible if a['typology'] == typology])
    return {'overall': overall, 'byTypology': grouped,
            'population': {'testTransactions': len(test_ids), 'metricTransactions': len(metric_ids),
                           'excludedTransactions': len(excluded_ids), 'eligibleAttempts': len(eligible),
                           'excludedAttempts': [{'id': a['id'], 'typology': a['typology'], 'reason': a['reason']}
                                                for a in excluded]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data/raw/amlworld')
    parser.add_argument('--dataset', type=Path, default=ROOT / 'data/models/dataset/events.json')
    parser.add_argument('--report', type=Path, default=ROOT / 'docs/data/milestone6-evaluation.json')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'docs/data/hi-small-manifest.json').read_text())
    dataset = json.loads(args.dataset.read_text())
    metadata, events = dataset['metadata'], dataset['events']
    frozen = json.loads((ROOT / 'docs/data/milestone4-evaluation.json').read_text())
    if metadata['sourceSha256'] != manifest['files'][FILES[0]]['sha256']:
        raise ValueError('Model dataset source mismatch')
    if metadata != frozen['dataset'] or len(events) != metadata['rows']:
        raise ValueError('Evaluation population differs from frozen transaction dataset')
    start, end = metadata['split']['validationEnd'], metadata['split']['end']
    if start != frozen['thresholdSelection']['windowEndExclusive'] or end != frozen['split']['test']['endExclusive']:
        raise ValueError('Case evaluation must use the frozen temporal test boundaries')
    attempts = ground_truth(args.data_dir, manifest, events)
    engine = EvaluationEngine(manifest['enabled_typologies'])
    for index, event in enumerate(events, 1):
        if event['timestamp'] >= end:
            raise ValueError('Future event in evaluation dataset')
        engine.process(event, emit_snapshot=False)
        if index % 500 == 0:
            print(f'Reconstructed {index}/{len(events)} events; {len(engine.findings)} findings, {len(engine.cases)} cases', flush=True)
    metrics = evaluate(engine.cases, attempts, events, engine.enabled, start, end)
    code_files = ['backend/python/engine.py', 'backend/python/signals.py', 'backend/python/evaluate_cases.py']
    report = {'schemaVersion': 1, 'status': 'ready', 'dataset': manifest['dataset'],
              'sourceSha256': metadata['sourceSha256'], 'sourceFiles': {n: manifest['files'][n]['sha256'] for n in FILES},
              'datasetSha256': digest(args.dataset), 'codeHashes': {n: digest(ROOT / n) for n in code_files},
              'transactionEvaluationSha256': digest(ROOT / 'docs/data/milestone4-evaluation.json'),
              'enabledTypologies': engine.enabled, 'window': {'start': start, 'endExclusive': end},
              'warmupEvents': sum(e['timestamp'] < start for e in events), 'replayedEvents': len(events),
              'scope': 'Structural case reconstruction, including LOW cases; not review-alert precision or learned-model case evaluation.',
              'matching': 'Any nonempty test-transaction overlap; maximum-cardinality one-to-one assignment, then maximum total Jaccard. No test-tuned overlap threshold.',
              'projection': 'Replay the full earlier prefix as warmup; freeze at test end. Project detected cases and complete supported attempts onto test transactions. Exclude unsupported and incomplete campaign transactions from named-rule metrics unless also part of an eligible supported attempt. Per-typology matching is independent and uses only evidence of that typology.',
              'limitations': ['Case-enriched bounded synthetic subset; not a complete HI-Small benchmark.',
                              'Overlap indicates partial reconstruction, not exact campaign recovery; inspect Jaccard and merge/fragmentation errors.',
                              'Per-typology counts are not additive: a case can contain multiple typologies.',
                              'Unsupported/RANDOM and ungrouped positives remain in the unchanged transaction evaluation.',
                              'Labels and pattern attempts are loaded only by this offline evaluator, never by runtime inference.'],
              **metrics}
    write_manifest(report, args.report)
    print(json.dumps(report['overall'], indent=2))


if __name__ == '__main__':
    main()
