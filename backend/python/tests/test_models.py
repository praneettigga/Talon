"""Leakage, contribution, failure and benign-control acceptance gates."""
from copy import deepcopy
from datetime import datetime, timedelta
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from backend.python.engine import Engine
from backend.python.signals import behaviour_vector, extract, graph_snapshot
from test_engine import edge

ROOT = Path(__file__).resolve().parents[3]
HAS_MODELS = all(importlib.util.find_spec(p) for p in ['numpy', 'sklearn', 'torch', 'torch_geometric', 'xgboost'])


class SignalTests(unittest.TestCase):
    def test_prefix_features_graphs_ignore_future_and_labels(self):
        events = [edge(i, 'A', 'B', i, amount=str(10 + i)) for i in range(1, 8)]
        prefix = extract(events[:4], ['FAN-OUT'])
        complete = extract(events, ['FAN-OUT'])
        self.assertEqual(prefix, complete[:4])
        poisoned = [{**e, 'label': 1, 'caseId': 'never-a-feature'} for e in events]
        for clean, changed in zip(complete, extract(poisoned, ['FAN-OUT'])):
            self.assertEqual(clean['features'], changed['features'])
            self.assertEqual(clean['rules'], changed['rules'])
            self.assertEqual(behaviour_vector(clean['features'][0]), behaviour_vector(changed['features'][0]))
        current = events[3]
        self.assertEqual(graph_snapshot(events, current), graph_snapshot(events[:4], current))


class ControlledModels:
    def __init__(self, behaviour, gin, risk):
        self.behaviour, self.gin, self.risk = behaviour, gin, risk
        self.status = {'status': 'ready', 'version': 'fixture', 'reviewThreshold': 60,
                       'error': None, 'graphModel': 'Test double', 'availableFrom': '2022-09-01', 'evaluation': None}

    def score(self, record):
        e = record['event']
        return {'status': 'scored', 'reason': 'Explicit artificial acceptance fixture', 'transactionId': e['id'],
                'asOf': e['timestamp'], 'riskScore': self.risk, 'behaviourScore': self.behaviour,
                'behaviourByAccount': {f['accountId']: self.behaviour for f in record['features']},
                'ginScore': self.gin, 'inputs': {}, 'contributions': [], 'modelVersion': 'fixture',
                'rawMargin': 0, 'baseMargin': 0, 'ruleScores': record['rules']}


class CorroborationTests(unittest.TestCase):
    def test_benign_high_value_anomaly_cannot_create_a_case(self):
        engine = Engine(['FAN-OUT'], ControlledModels(1, .1, 95))
        result = engine.process(edge(1, 'A', 'B', 1, amount='10000000'))
        self.assertFalse(result['cases'])

    def test_payroll_like_structure_stays_low_without_corroboration(self):
        engine = Engine(['FAN-OUT'], ControlledModels(.3, .2, 95))
        engine.process(edge(1, 'Payroll', 'A', 1))
        result = engine.process(edge(2, 'Payroll', 'B', 2))
        self.assertEqual(result['cases'][0]['severity'], 'LOW')
        self.assertEqual(result['cases'][0]['severityInputs']['corroboratedSignals'], 0)
        self.assertTrue(all(not e['suspect'] for e in result['cases'][0]['entities']))

    def test_supported_structure_grows_to_review_with_explicit_inputs(self):
        model = ControlledModels(.3, .2, 20)
        engine = Engine(['FAN-IN'], model)
        engine.process(edge(1, 'A', 'M', 1)); before = engine.process(edge(2, 'B', 'M', 2))
        self.assertEqual(before['cases'][0]['severity'], 'LOW')
        prefix = deepcopy(before['decisions'])
        model.gin = .9; model.risk = 75
        after = engine.process(edge(3, 'C', 'M', 3))
        self.assertEqual(after['cases'][0]['severity'], 'MEDIUM')
        self.assertEqual(after['cases'][0]['severityInputs']['signalTypes'], ['GIN'])
        self.assertEqual(after['cases'][0]['severityInputs']['reviewThreshold'], 60)
        self.assertEqual(after['decisions'][:2], prefix)
        self.assertEqual(next(e for e in after['cases'][0]['entities'] if e['id'] == '001/A')['roles'], ['counterparty'])

    def test_entity_risk_decays_and_expired_evidence_does_not_escalate(self):
        model = ControlledModels(1, .9, 90)
        engine = Engine(['FAN-OUT'], model)
        engine.process(edge(1, 'M', 'A', 1)); engine.process(edge(2, 'M', 'B', 2))
        model.risk = 0; model.gin = .1; model.behaviour = .1
        later = edge(3, 'M', 'C'); later['timestamp'] = '2022-09-02T00:02:00'
        after = engine.process(later)
        self.assertAlmostEqual(after['entityRisks']['001/M']['riskScore'], 90 / 2.718281828, places=3)
        self.assertAlmostEqual(after['entityRisks']['001/B']['riskScore'], 90 / 2.718281828, places=3)
        self.assertEqual(after['entityRisks']['001/B']['riskAsOf'], later['timestamp'])
        self.assertNotEqual(after['entityRisks']['001/B']['asOf'], later['timestamp'])
        late = edge(4, 'M', 'D'); late['timestamp'] = '2022-09-20T00:02:00'
        expired = engine.process(late)
        self.assertEqual(expired['cases'][0]['severity'], 'LOW')


@unittest.skipUnless(HAS_MODELS, 'Install backend model requirements to verify trained components')
class TrainedModelsTests(unittest.TestCase):
    def setUp(self):
        from backend.python.models import ModelRunner
        path = ROOT / 'data/models/current/metadata.json'
        if not path.exists():
            self.skipTest('Run models:train for artifact integration acceptance')
        self.meta = json.loads(path.read_text())
        self.runner = ModelRunner(path.parent, self.meta['sourceSha256'], self.meta['enabledTypologies'])

    def test_cutoff_prefix_scores_contributions_and_reset_determinism(self):
        start = datetime.fromisoformat(self.meta['availableFrom'])
        events = [edge(i, 'A', 'B' if i < 7 else 'C', amount=str(i * 10)) for i in range(1, 9)]
        for i, e in enumerate(events):
            e['timestamp'] = (start + timedelta(minutes=i)).isoformat()
        engine = Engine(self.meta['enabledTypologies'], self.runner)
        for e in events[:4]:
            engine.process(e)
        prefix = engine.snapshot()['decisions']
        for e in events[4:]:
            engine.process(e)
        completed = engine.snapshot()
        self.assertEqual(prefix, completed['decisions'][:4])
        for decision in completed['decisions']:
            r = decision['risk']
            self.assertEqual(r['status'], 'scored')
            self.assertGreaterEqual(r['riskScore'], 0); self.assertLessEqual(r['riskScore'], 100)
            self.assertAlmostEqual(r['rawMargin'], r['baseMargin'] + sum(c['value'] for c in r['contributions']), places=5)
        again = Engine(self.meta['enabledTypologies'], self.runner)
        for e in events:
            again.process(e)
        self.assertEqual(completed, again.snapshot())
        historical = edge(1, 'A', 'B')
        unscored = Engine([], self.runner).process(historical)['decisions'][0]['risk']
        self.assertEqual(unscored['status'], 'historical warmup'); self.assertIsNone(unscored['riskScore'])

    def test_tampered_artifact_is_unavailable_before_deserialization(self):
        from backend.python.models import ModelRunner
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'metadata.json').write_text(json.dumps(self.meta))
            (path / 'behaviour.joblib').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                ModelRunner(path, self.meta['sourceSha256'], self.meta['enabledTypologies'])

    def test_forward_folds_and_frozen_threshold_provenance(self):
        report = self.meta['evaluation']
        for fold in report['forwardFolds']:
            self.assertLess(fold['maxFitLabelTime'], fold['firstFusionTime'])
        self.assertLessEqual(report['calibration']['endExclusive'], report['thresholdSelection']['windowStart'])
        self.assertEqual(report['thresholdSelection']['windowEndExclusive'], self.meta['availableFrom'])
        self.assertEqual(report['test']['threshold'], self.meta['reviewThreshold'])
        self.assertGreaterEqual(report['test']['rows'] - report['test']['positives'], 32)


if __name__ == '__main__':
    unittest.main()
