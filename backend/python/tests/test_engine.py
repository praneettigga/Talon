from copy import deepcopy
import unittest

from backend.python.engine import Engine, SUPPORTED


def edge(number, sender, receiver, minute=0, currency='USD', amount='10.00'):
    return {'id': f'hi-small:{number}', 'sourceRow': number,
            'timestamp': f'2022-09-01T00:{minute:02d}:00', 'fromBank': '001', 'fromAccount': sender,
            'toBank': '001', 'toAccount': receiver, 'amountPaid': amount, 'amountReceived': amount,
            'paymentCurrency': currency, 'receivingCurrency': currency, 'paymentFormat': 'ACH'}


class EngineTests(unittest.TestCase):
    def run_edges(self, pairs, enabled=SUPPORTED):
        engine = Engine(enabled)
        for number, (sender, receiver) in enumerate(pairs, 1):
            engine.process(edge(number, sender, receiver, number))
        return engine

    def test_each_supported_structure(self):
        examples = {
            'FAN-IN': [('A', 'M'), ('B', 'M')],
            'FAN-OUT': [('M', 'A'), ('M', 'B')],
            'GATHER-SCATTER': [('A', 'M'), ('B', 'M'), ('M', 'X'), ('M', 'Y')],
            'SCATTER-GATHER': [('A', 'M'), ('A', 'N'), ('M', 'X'), ('N', 'X')],
            'CYCLE': [('A', 'B'), ('B', 'C'), ('C', 'A')],
            'STACK': [('A', 'B'), ('B', 'C'), ('C', 'D')],
            'BIPARTITE': [('A', 'X'), ('B', 'X'), ('A', 'Y'), ('B', 'Y')],
        }
        for typology, pairs in examples.items():
            with self.subTest(typology=typology):
                engine = self.run_edges(pairs, [typology])
                self.assertEqual(len(engine.snapshot()['cases']), 1)
                case = engine.snapshot()['cases'][0]
                self.assertEqual(case['typologies'], [typology])
                self.assertEqual(case['severity'], 'LOW')
                self.assertEqual(case['severityInputs']['corroboratedSignals'], 0)
                self.assertTrue(all(not e['suspect'] for e in case['entities']))

    def test_prior_features_and_currency_boundaries(self):
        engine = Engine([])
        first = engine.process(edge(1, 'A', 'B', 1, amount='1000000.00'))
        self.assertEqual(first['decisions'][0]['features'][0]['oneHourVelocity'], 0)
        self.assertIsNone(first['decisions'][0]['features'][0]['amountZScore'])
        engine.process(edge(2, 'A', 'C', 2, 'EUR', '5.00'))
        result = engine.process(edge(3, 'A', 'D', 3, 'USD', '12.00'))
        usd = result['decisions'][-1]['features'][0]
        self.assertEqual(usd['outgoingTotal'], '1000000.00')
        self.assertEqual(usd['outgoingCount'], 1)
        self.assertEqual(result['decisions'][0], first['decisions'][0])
        self.assertFalse(result['cases'])

    def test_one_hour_expiry(self):
        engine = Engine([])
        engine.process(edge(1, 'A', 'B'))
        event = edge(2, 'A', 'C')
        event['timestamp'] = '2022-09-01T01:01:00'
        feature = engine.process(event)['decisions'][-1]['features'][0]
        self.assertEqual(feature['oneHourVelocity'], 0)
        self.assertEqual(feature['historyCount'], 1)

    def test_disabled_random_and_self_transfers(self):
        engine = self.run_edges([('A', 'B'), ('A', 'C')], ['RANDOM', 'UNSUPPORTED'])
        self.assertFalse(engine.snapshot()['cases'])
        engine = self.run_edges([('A', 'A'), ('A', 'A')])
        self.assertFalse(engine.snapshot()['cases'])

    def test_reverse_time_path_does_not_create_cycle_or_chain(self):
        engine = self.run_edges([('C', 'A'), ('B', 'C'), ('A', 'B')], ['CYCLE', 'STACK'])
        self.assertFalse(engine.snapshot()['cases'])

    def test_case_growth_prefix_stability_reset_and_counterparty_roles(self):
        prefix = [('A', 'M'), ('B', 'M')]
        engine = self.run_edges(prefix)
        before = engine.snapshot()
        case_id = before['cases'][0]['id']
        engine.process(edge(3, 'C', 'M', 3))
        after = engine.snapshot()
        self.assertEqual(after['cases'][0]['id'], case_id)
        self.assertEqual(len(after['cases']), 1)
        self.assertEqual(len(after['cases'][0]['transactionIds']), 3)
        self.assertEqual(after['decisions'][:2], before['decisions'])
        self.assertEqual(before, self.run_edges(prefix).snapshot())
        self.assertEqual(after, self.run_edges(prefix + [('C', 'M')]).snapshot())
        sources = [e for e in after['cases'][0]['entities'] if e['id'] == '001/A']
        self.assertEqual(sources[0]['roles'], ['counterparty'])

    def test_disconnected_findings_are_not_merged_by_time(self):
        engine = self.run_edges([('A', 'M'), ('B', 'M'), ('C', 'N'), ('D', 'N')], ['FAN-IN'])
        self.assertEqual(len(engine.snapshot()['cases']), 2)

    def test_slow_structure_has_explicit_window_and_no_escalation(self):
        engine = Engine(['FAN-OUT'])
        engine.process(edge(1, 'M', 'A'))
        late = edge(2, 'M', 'B')
        late['timestamp'] = '2022-09-04T00:00:00'
        case = engine.process(late)['cases'][0]
        self.assertEqual(case['evidence'][0]['window']['limit'], '7 days')
        self.assertEqual(case['severity'], 'LOW')
        outside = edge(3, 'M', 'C')
        outside['timestamp'] = '2022-09-20T00:00:00'
        engine.process(outside)
        self.assertEqual(len(engine.snapshot()['cases'][0]['timeline']), 1)

    def test_order_and_duplicate_rejected_without_overwriting_decisions(self):
        engine = Engine([])
        engine.process(edge(1, 'A', 'B'))
        before = deepcopy(engine.snapshot())
        with self.assertRaises(ValueError):
            engine.process(edge(1, 'A', 'B'))
        self.assertEqual(engine.snapshot(), before)

    def test_expired_match_remains_evidence_when_a_new_window_grows(self):
        engine = Engine(['FAN-OUT'])
        engine.process(edge(1, 'M', 'A'))
        second = edge(2, 'M', 'B'); second['timestamp'] = '2022-09-02T00:00:00'
        before = engine.process(second)
        later = edge(3, 'M', 'C'); later['timestamp'] = '2022-09-09T00:00:00'
        after = engine.process(later)
        self.assertEqual(len(after['cases']), 1)
        self.assertEqual(after['cases'][0]['transactionIds'], ['hi-small:1', 'hi-small:2', 'hi-small:3'])
        self.assertEqual(after['cases'][0]['evidence'][0], before['cases'][0]['evidence'][0])
        self.assertTrue(after['cases'][0]['connections'])


if __name__ == '__main__':
    unittest.main()
