"""Metric definitions and offline/live parity, using explicit artificial records."""
import unittest
from backend.python.evaluate_cases import EvaluationEngine, evaluate, match_cases
from datetime import datetime, timedelta
from copy import deepcopy
import random
import json
from pathlib import Path
from backend.python.engine import Engine
from test_engine import edge


def item(identity, ids, typology='FAN-OUT'):
    return {'id': identity, 'transactionIds': ids, 'typology': typology,
            'times': ['2022-09-01T00:01:00'],
            'evidence': [{'typology': typology, 'transactionIds': ids}]}


class CaseEvaluationTests(unittest.TestCase):
    def test_one_to_one_prevents_duplicate_recall_and_penalizes_merges(self):
        duplicate = match_cases([item('a', ['1']), item('b', ['1'])], [item('x', ['1'])])
        self.assertEqual((duplicate['precision'], duplicate['recall']), (.5, 1))
        merged = match_cases([item('a', ['1', '2'])], [item('x', ['1']), item('y', ['2'])])
        self.assertEqual((merged['precision'], merged['recall'], merged['meanMatchedJaccard']), (1, .5, .5))

    def test_maximum_cardinality_then_jaccard_and_order_determinism(self):
        cases = [item('a', ['1', '2']), item('b', ['1'])]
        truth = [item('x', ['1']), item('y', ['2'])]
        result = match_cases(cases, truth)
        self.assertEqual(result['matched'], 2)
        self.assertEqual(result, match_cases(list(reversed(cases)), list(reversed(truth))))
        self.assertEqual([(p['caseId'], p['attemptId']) for p in result['matches']], [('a', 'y'), ('b', 'x')])

    def test_empty_denominators_and_no_overlap(self):
        empty = match_cases([], [])
        self.assertIsNone(empty['precision']); self.assertIsNone(empty['recall'])
        result = match_cases([item('a', ['1'])], [item('x', ['2'])])
        self.assertEqual((result['precision'], result['recall']), (0, 0))
        self.assertIsNone(result['meanMatchedJaccard'])

    def test_test_projection_warmup_unsupported_incomplete_and_typology(self):
        events = [edge(i, 'A', str(i), i) for i in range(1, 5)]
        ids = [e['id'] for e in events]
        attempts = [item('x', ids[:2]), item('random', [ids[2]], 'RANDOM'),
                    item('incomplete', [ids[3], 'future'])]
        cases = [item('case', ids)]
        report = evaluate(cases, attempts, events, ['FAN-OUT', 'CYCLE'], events[1]['timestamp'], '2022-09-02')
        self.assertEqual(report['population']['metricTransactions'], 1)
        self.assertEqual(report['overall']['meanMatchedJaccard'], 1)
        self.assertEqual(report['overall']['matched'], 1)
        self.assertEqual(len(report['population']['excludedAttempts']), 2)
        self.assertIsNone(report['byTypology']['CYCLE']['recall'])

    def test_offline_transitions_identical_to_live_and_future_prefix_immutable(self):
        events = [edge(1, 'A', 'M', 1), edge(2, 'B', 'M', 2), edge(3, 'M', 'X', 3), edge(4, 'M', 'Y', 4)]
        live, offline = Engine(['FAN-IN', 'FAN-OUT']), Engine(['FAN-IN', 'FAN-OUT'])
        for event in events[:2]:
            live.process(event); offline.process(event, emit_snapshot=False)
        prefix = offline.snapshot()
        self.assertEqual(prefix, live.snapshot())
        for event in events[2:]:
            live.process(event); offline.process(event, emit_snapshot=False)
        self.assertEqual(offline.snapshot(), live.snapshot())
        self.assertEqual(prefix['decisions'], offline.snapshot()['decisions'][:2])

    def test_supported_ground_truth_keeps_shared_transactions_with_excluded_attempts(self):
        event = edge(1, 'A', 'B', 1)
        ids = [event['id']]
        report = evaluate([item('case', ids)], [item('supported', ids), item('random', ids, 'RANDOM')],
                          [event], ['FAN-OUT'], event['timestamp'], '2022-09-02')
        self.assertEqual(report['population']['excludedTransactions'], 0)
        self.assertEqual(report['overall']['recall'], 1)

    def test_incremental_evaluator_matches_full_detector_with_expiry_and_merges(self):
        from backend.python.engine import SUPPORTED
        for seed in range(3):
            rng = random.Random(seed)
            live, offline = Engine(SUPPORTED), EvaluationEngine(SUPPORTED)
            for n in range(1, 31):
                sender, receiver = rng.sample(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 2)
                event = edge(n, sender, receiver)
                event['timestamp'] = (datetime(2022, 9, 1) + timedelta(days=(n // 12) * 8, minutes=n)).isoformat()
                live.process(event, emit_snapshot=False); offline.process(event, emit_snapshot=False)
                self.assertEqual(offline.cases, live.cases, (seed, n))
                self.assertEqual(offline.findings, live.findings, (seed, n))

    def test_real_replay_offline_and_live_reconstruction_parity(self):
        root = Path(__file__).resolve().parents[3]
        replay_path = root / 'data/replay/replay.json'
        if not replay_path.exists():
            self.skipTest('Prepare the real replay for integration acceptance')
        events = json.loads(replay_path.read_text())['events']
        enabled = json.loads((root / 'docs/data/hi-small-manifest.json').read_text())['enabled_typologies']
        live, offline = Engine(enabled), EvaluationEngine(enabled)
        for event in events:
            live.process(event, emit_snapshot=False); offline.process(event, emit_snapshot=False)
            self.assertEqual(offline.cases, live.cases, event['id'])
            self.assertEqual(offline.findings, live.findings, event['id'])

    def test_partial_expiry_cannot_create_evidence_on_unrelated_transfer(self):
        live, offline = Engine(['FAN-OUT']), EvaluationEngine(['FAN-OUT'])
        records = [('M', 'A', '2022-09-01T00:00:00'), ('M', 'B', '2022-09-02T00:00:00'),
                   ('M', 'C', '2022-09-09T01:00:00'), ('M', 'D', '2022-09-09T02:00:00'),
                   ('M', 'E', '2022-09-09T03:00:00'), ('Z', 'Q', '2022-09-16T01:30:00')]
        before = None
        last_seen = None
        for n, (sender, receiver, time) in enumerate(records, 1):
            event = edge(n, sender, receiver); event['timestamp'] = time
            live.process(event, emit_snapshot=False); offline.process(event, emit_snapshot=False)
            self.assertEqual(live.cases, offline.cases)
            self.assertEqual(live.findings, offline.findings)
            if n == 5:
                before = deepcopy(live.findings)
                last_seen = [case['lastSeen'] for case in live.cases]
        self.assertEqual(live.findings, before)
        self.assertEqual([case['lastSeen'] for case in live.cases], last_seen)

    def test_connected_cases_merge_preserve_connections_and_reset_identically(self):
        enabled = ['FAN-IN', 'FAN-OUT', 'GATHER-SCATTER']
        pairs = [('A', 'M'), ('B', 'M'), ('M', 'P'), ('M', 'Q'),
                 ('X', 'N'), ('Y', 'N'), ('N', 'R'), ('N', 'S'), ('M', 'N'), ('M', 'T')]
        events = [edge(n, sender, receiver, n) for n, (sender, receiver) in enumerate(pairs, 1)]
        engine = Engine(enabled)
        for event in events[:8]:
            engine.process(event, emit_snapshot=False)
        self.assertEqual(len(engine.cases), 2)
        existing = [deepcopy(link) for case in engine.cases for link in case['connections']]
        self.assertTrue(existing)
        for event in events[8:]:
            engine.process(event, emit_snapshot=False)
        self.assertEqual(len(engine.cases), 1)
        case = engine.cases[0]
        self.assertTrue(case['mergedCaseIds'])
        self.assertTrue(all(link in case['connections'] for link in existing))
        again = Engine(enabled)
        for event in events:
            again.process(event, emit_snapshot=False)
        self.assertEqual(engine.snapshot(), again.snapshot())
