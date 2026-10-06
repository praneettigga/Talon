import csv
import tempfile
from pathlib import Path
import unittest

from pipeline.data import FILES, TX_HEADER, ACCOUNT_HEADER, DataError, profile
from pipeline.replay import build


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pattern = ['2022/09/01 12:00', '001', '00A', '002', '00B', '10.000000', 'Euro', '10.000000', 'Euro', 'ACH', '1']
        rows = [self.pattern, self.pattern[:10] + ['0'], ['2022/09/01 11:59'] + self.pattern[1:10] + ['0'],
                ['2022/09/03 12:00'] + self.pattern[1:10] + ['0']]
        with (self.root / FILES[0]).open('w', newline='') as out:
            writer = csv.writer(out); writer.writerow(TX_HEADER); writer.writerows(rows)
        with (self.root / FILES[1]).open('w', newline='') as out:
            writer = csv.writer(out); writer.writerow(ACCOUNT_HEADER); writer.writerow(['Bank', '001', '00A', 'E', 'Entity'])
        (self.root / FILES[2]).write_text('BEGIN LAUNDERING ATTEMPT - FAN-IN\n' + ','.join(self.pattern) + '\nEND LAUNDERING ATTEMPT - FAN-IN\n')
        self.manifest = profile(self.root)

    def test_stable_order_exact_values_context_boundary_and_no_labels(self):
        payload, provenance = build(self.root, self.manifest)
        self.assertEqual((payload, provenance), build(self.root, self.manifest))
        self.assertEqual([e['sourceRow'] for e in payload['events']], [3, 1, 2])
        self.assertEqual(payload['events'][1]['fromBank'], '001')
        self.assertEqual(payload['events'][1]['amountPaid'], '10.000000')
        self.assertNotIn('typology', str(payload))
        self.assertNotIn('Is Laundering', str(payload))
        self.assertEqual(provenance['source_rows'][1]['fields'], self.pattern)
        self.assertEqual(provenance['attempts'][0]['transaction_ids'], ['hi-small:1'])

    def test_context_bound(self):
        payload, provenance = build(self.root, self.manifest, context_limit=1)
        self.assertEqual(len(payload['events']), 2)
        self.assertEqual(provenance['context_rows'], 1)

    def test_source_change_rejected(self):
        with (self.root / FILES[0]).open('a') as out:
            out.write('\n')
        with self.assertRaisesRegex(DataError, 'checksum'):
            build(self.root, self.manifest)
