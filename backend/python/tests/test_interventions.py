from copy import deepcopy
import unittest

from backend.python.interventions import simulate
from test_engine import edge


def request(pairs, held, compare=None, sources=None):
    events = [edge(n, a, b, n) for n, (a, b) in enumerate(pairs, 1)]
    ids = sorted({f'001/{a}' for pair in pairs for a in pair})
    result = {'case': {'id': 'case-fixture', 'transactionIds': [e['id'] for e in events],
                     'entities': [{'id': a, 'roles': ['counterparty'] if a == '001/X' else ['intermediary']} for a in ids]},
              'events': events, 'observedAt': events[-1]['timestamp'], 'snapshotCursor': len(events),
              'heldAccountIds': [f'001/{a}' for a in held]}
    if compare is not None:
        result['compareHeldAccountIds'] = [f'001/{a}' for a in compare]
    if sources is not None:
        result['sourceAccountIds'] = [f'001/{a}' for a in sources]
    return result


class InterventionTests(unittest.TestCase):
    def test_single_vs_group_parallel_route_and_no_mutation(self):
        payload = request([('A', 'M1'), ('A', 'M2'), ('M1', 'X'), ('M2', 'X')], ['M1'], ['M1', 'M2'])
        before = deepcopy(payload)
        result = simulate(payload)
        single, group = result['scenarios']
        self.assertEqual(result['sourceAccountIds'], ['001/A'])
        self.assertEqual(single['interruptedTransferIds'], ['hi-small:3'])
        self.assertFalse(single['noLongerReachableAccountIds'])
        alternate = next(r for r in single['remainingRoutes'] if r['destination'] == '001/X')
        self.assertTrue(alternate['alternateToInterruptedBaseline'])
        self.assertEqual(alternate['accountIds'], ['001/A', '001/M2', '001/X'])
        self.assertEqual(group['noLongerReachableAccountIds'], ['001/X'])
        self.assertEqual(group['directlyTouchedAccountIds'], ['001/M1', '001/M2', '001/X'])
        self.assertEqual(group['touchedCounterpartyIds'], ['001/X'])
        self.assertEqual(result['comparison']['additionalInterruptedTransferIds'], ['hi-small:4'])
        self.assertEqual(result['comparison']['additionalUnreachableAccountIds'], ['001/X'])
        self.assertEqual(payload, before)
        self.assertEqual(simulate(payload), result)

    def test_chain_source_hold_and_destination_hold(self):
        pairs = [('A', 'B'), ('B', 'C'), ('C', 'X')]
        result = simulate(request(pairs, ['A']))
        self.assertEqual(result['scenarios'][0]['noLongerReachableAccountIds'], ['001/B', '001/C', '001/X'])
        sink = simulate(request(pairs, ['X']))['scenarios'][0]
        self.assertEqual(sink['interruptedTransferCount'], 0)
        self.assertEqual(sink['reachableAccountIds'], ['001/B', '001/C', '001/X'])

    def test_cycle_fallback_parallel_edges_and_explicit_source(self):
        payload = request([('A', 'B'), ('A', 'B'), ('B', 'C'), ('C', 'A')], ['A'])
        result = simulate(payload)
        self.assertIn('cycle entry', result['sourcePolicy'])
        self.assertEqual(result['sourceAccountIds'], ['001/A'])
        self.assertEqual(result['scenarios'][0]['interruptedTransferCount'], 2)
        self.assertEqual(result['scenarios'][0]['noLongerReachableAccountIds'], ['001/B', '001/C'])
        payload['sourceAccountIds'] = ['001/B']
        changed = simulate(payload)
        self.assertEqual(changed['sourceAccountIds'], ['001/B'])
        self.assertEqual(changed['scenarios'][0]['noLongerReachableAccountIds'], [])

    def test_unknown_duplicate_future_and_incomplete_evidence_rejected(self):
        original = request([('A', 'B'), ('B', 'X')], ['B'])
        for changed in [
            {**original, 'heldAccountIds': ['001/Future']},
            {**original, 'sourceAccountIds': ['001/Future']},
            {**original, 'heldAccountIds': ['001/B', '001/B']},
            {**original, 'compareHeldAccountIds': ['001/A']},
            {**original, 'observedAt': '2022-09-01T00:01:00'},
            {**original, 'events': original['events'][:1]},
        ]:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                simulate(changed)
        self.assertEqual(simulate(original)['baseline']['transferCount'], 2)

    def test_report_bounds_routes_without_truncating_counts(self):
        pairs = [('A', f'N{i}') for i in range(55)]
        payload = request(pairs, ['N1'])
        result = simulate(payload)['scenarios'][0]
        self.assertEqual(result['remainingRouteCount'], 55)
        self.assertEqual(len(result['remainingRoutes']), 50)
        self.assertTrue(result['routesTruncated'])
        self.assertEqual(result['interruptedTransferCount'], 0)


if __name__ == '__main__':
    unittest.main()
