from copy import deepcopy
import csv
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from backend.python.engine import Engine, SUPPORTED
from backend.python.enrichment import Enrichment, HEADER, LABEL
from backend.python.prepare_enrichment import generate
from test_engine import edge
from test_models import ControlledModels


def artifact(path, events, rows=None):
    rows = rows if rows is not None else generate(events, SUPPORTED)[0]
    with path.open('w', newline='') as target:
        writer = csv.DictWriter(target, fieldnames=HEADER); writer.writeheader(); writer.writerows(rows)
    meta = {'schemaVersion': 1, 'label': LABEL, 'replaySha256': 'r' * 64, 'sourceSha256': 's' * 64,
            'csvSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'rows': len(rows),
            'accountIds': sorted({row['account_id'] for row in rows})}
    path.with_suffix('.manifest.json').write_text(json.dumps(meta))
    return Enrichment(path, 'r' * 64, 's' * 64)


class EnrichmentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / 'talon_device_context.csv'
        self.events = [edge(i, a, b, i) for i, (a, b) in enumerate([
            ('Control1', 'Control2'), ('A', 'M1'), ('A', 'M2'), ('M1', 'X'), ('M2', 'X')], 1)]

    def test_generation_is_label_free_bounded_and_prefix_visible(self):
        rows, controls, pair = generate(self.events, SUPPORTED)
        self.assertEqual(controls, ['001/Control1', '001/Control2'])
        self.assertEqual(pair, ['001/M1', '001/M2'])
        self.assertEqual(generate([{**e, 'Is Laundering': 1, 'caseId': 'ground-truth'} for e in self.events], SUPPORTED), (rows, controls, pair))
        self.assertEqual({r['account_id'] for r in rows}, {f'001/{a}' for a in ['Control1', 'Control2', 'A', 'M1', 'M2', 'X']})
        context = artifact(self.path, self.events)
        engine = Engine(SUPPORTED, enrichment=context)
        self.assertEqual(engine.snapshot()['enrichment']['accounts'], {})
        before = None
        for event in self.events:
            snapshot = engine.process(event)
            if event['id'] == 'hi-small:4':
                before = deepcopy(snapshot)
        control = next(link for link in before['enrichment']['links'] if link['value'] == 'talon-network-control')
        self.assertFalse(control['supportsStructure'])
        self.assertNotIn('talon-device-demonstration', str(before['enrichment']))
        device = next(link for link in snapshot['enrichment']['links'] if link['kind'] == 'device')
        self.assertTrue(device['supportsStructure']); self.assertTrue(device['supportingFindingIds'])
        self.assertEqual(device['firstSeen'], self.events[-1]['timestamp'])
        self.assertEqual(snapshot['decisions'][:4], before['decisions'])
        self.assertFalse(snapshot['enrichment']['usedInRiskModel']); self.assertFalse(snapshot['enrichment']['affectsSeverity'])

    def test_control_sharing_and_demonstration_leave_frozen_risk_and_severity_unchanged(self):
        context = artifact(self.path, self.events)
        plain = Engine(SUPPORTED, ControlledModels(.3, .2, 95))
        enriched = Engine(SUPPORTED, ControlledModels(.3, .2, 95), enrichment=context)
        for event in self.events:
            a, b = plain.process(event), enriched.process(event)
            self.assertEqual([d['risk'] for d in a['decisions']], [d['risk'] for d in b['decisions']])
            self.assertEqual(a['cases'], b['cases'])
            self.assertTrue(all(c['severity'] == 'LOW' for c in b['cases']))

    def test_replay_binding_csv_corruption_and_future_observations(self):
        context = artifact(self.path, self.events)
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            Enrichment(self.path, 'different', 's' * 64)
        with self.path.open('a') as out:
            out.write('\n')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            Enrichment(self.path, 'r' * 64, 's' * 64)
        early = context.snapshot(self.events[:1], {})
        self.assertEqual(set(early['accounts']), {'001/Control1', '001/Control2'})

    def test_reset_and_prefix_repreparation_preserve_context(self):
        complete = artifact(self.path, self.events)
        prefix_path = self.path.with_name('prefix.csv')
        prefix = artifact(prefix_path, self.events[:4])
        def replay(context, events):
            engine = Engine(SUPPORTED, enrichment=context)
            for event in events:
                engine.process(event)
            return engine.snapshot()
        self.assertEqual(replay(complete, self.events[:4]), replay(prefix, self.events[:4]))
        self.assertEqual(replay(complete, self.events), replay(complete, self.events))


if __name__ == '__main__':
    unittest.main()
