"""Label-free structural evidence. Decimal amounts never cross currency boundaries."""
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timedelta
from decimal import Decimal
import hashlib
import json
import math

SUPPORTED = {'FAN-IN', 'FAN-OUT', 'GATHER-SCATTER', 'SCATTER-GATHER', 'CYCLE', 'BIPARTITE', 'STACK'}
GRAPH_WINDOW = timedelta(days=7)


def account(bank, number):
    return f'{bank}/{number}'


def stamp(event):
    return datetime.fromisoformat(event['timestamp'])


def endpoints(event):
    return account(event['fromBank'], event['fromAccount']), account(event['toBank'], event['toAccount'])


class Engine:
    def __init__(self, enabled):
        self.enabled = sorted(SUPPORTED.intersection(enabled))
        self.events = []
        self.decisions = []
        self.findings = {}
        self.cases = []
        self.entities = {}

    def features(self, entity, currency, current, other, now):
        flows = []
        seen = set()
        for event in self.events:
            sender, receiver = endpoints(event)
            if entity not in (sender, receiver):
                continue
            peer = receiver if sender == entity else sender
            seen.add(peer)
            if sender == entity and event['paymentCurrency'] == currency:
                flows.append((event, 'out', Decimal(event['amountPaid']), peer))
            if receiver == entity and event['receivingCurrency'] == currency:
                flows.append((event, 'in', Decimal(event['amountReceived']), peer))
        recent = [f for f in flows if stamp(f[0]) >= now - timedelta(hours=1)]
        incoming = [f for f in recent if f[1] == 'in']
        outgoing = [f for f in recent if f[1] == 'out']
        values = [f[2] for f in flows]
        mean = sum(values, Decimal(0)) / len(values) if values else Decimal(0)
        variance = sum((v - mean) ** 2 for v in values) / len(values) if values else Decimal(0)
        deviation = variance.sqrt()
        total_in = sum((f[2] for f in incoming), Decimal(0))
        total_out = sum((f[2] for f in outgoing), Decimal(0))
        prior_hour_peers = {f[3] for f in recent}
        old_peers = {f[3] for f in flows if stamp(f[0]) < now - timedelta(hours=1)}
        # A zero variance baseline or short history yields no deviation penalty.
        zscore = abs((Decimal(current) - mean) / deviation) if len(values) >= 5 and deviation else None
        finite_ratio = lambda a, b: round(float(a / b), 6) if b and math.isfinite(float(a / b)) else None
        return {
            'accountId': entity, 'currency': currency, 'asOf': now.isoformat(),
            'historyCount': len({f[0]['id'] for f in flows}),
            'historyStatus': 'sufficient' if len(values) >= 5 else 'insufficient behavioural history',
            'incomingCount': len(incoming), 'outgoingCount': len(outgoing),
            'incomingTotal': str(total_in), 'outgoingTotal': str(total_out),
            'fanInDegree': len({f[3] for f in incoming}), 'fanOutDegree': len({f[3] for f in outgoing}),
            'fiveMinuteVelocity': len({f[0]['id'] for f in recent if stamp(f[0]) >= now - timedelta(minutes=5)}),
            'oneHourVelocity': len({f[0]['id'] for f in recent}),
            'amountMean': str(mean) if values else None, 'amountDeviation': str(deviation) if values else None,
            'amountZScore': round(float(zscore), 6) if zscore is not None and math.isfinite(float(zscore)) else None,
            'forwardingRatio': finite_ratio(total_out, total_in),
            'incomingOutgoingRatio': finite_ratio(total_in, total_out),
            'newCounterparty': other not in seen,
            'newCounterpartyRate': len(prior_hour_peers - old_peers) / len(prior_hour_peers) if prior_hour_peers else 0,
            'accountAge': None,
        }

    def process(self, event):
        if self.events and (event['timestamp'], event['sourceRow']) <= (self.events[-1]['timestamp'], self.events[-1]['sourceRow']):
            raise ValueError('Events must arrive in strict timestamp/source-row order')
        if any(e['id'] == event['id'] for e in self.events):
            raise ValueError('Duplicate event ID')
        now = stamp(event)
        sender, receiver = endpoints(event)
        features = [self.features(sender, event['paymentCurrency'], event['amountPaid'], receiver, now),
                    self.features(receiver, event['receivingCurrency'], event['amountReceived'], sender, now)]
        decision = {'transactionId': event['id'], 'timestamp': event['timestamp'], 'features': features}
        self.decisions.append(decision)
        for feature in features:
            self.entities[feature['accountId']] = feature
        self.events.append(deepcopy(event))
        active = [e for e in self.events if stamp(e) >= now - GRAPH_WINDOW and endpoints(e)[0] != endpoints(e)[1]]
        for candidate in self.detect(active, event):
            if candidate['typology'] not in self.enabled:
                continue
            key = candidate['id']
            previous = self.findings.get(key)
            if previous and not set(previous['transactionIds']).issubset(candidate['transactionIds']):
                if set(candidate['transactionIds']).issubset(previous['transactionIds']):
                    continue  # Expiry alone is not new evidence.
                # Keep the older matched window intact when a fresh window grows.
                candidate['id'] += '-' + hashlib.sha256(candidate['transactionIds'][0].encode()).hexdigest()[:8]
                key = candidate['id']
                previous = self.findings.get(key)
            if previous and previous['transactionIds'] == candidate['transactionIds']:
                continue
            candidate['firstSeen'] = previous['firstSeen'] if previous else event['timestamp']
            self.findings[key] = candidate
            self.correlate(candidate, event['timestamp'])
        return self.snapshot()

    def finding(self, typology, anchors, edges, roles, facts, strength):
        unique = {e['id']: e for e in edges}
        edges = sorted(unique.values(), key=lambda e: (e['timestamp'], e['sourceRow']))
        entities = sorted({a for e in edges for a in endpoints(e)})
        identity = json.dumps([typology, sorted(anchors)], separators=(',', ':'))
        return {'id': 'finding-' + hashlib.sha256(identity.encode()).hexdigest()[:16],
                'typology': typology, 'strength': round(min(1, strength), 3),
                'anchors': sorted(anchors), 'accountIds': entities, 'roles': roles,
                'transactionIds': [e['id'] for e in edges],
                'window': {'first': edges[0]['timestamp'], 'last': edges[-1]['timestamp'], 'limit': '7 days'},
                'observedAt': self.events[-1]['timestamp'], 'facts': facts,
                'corroborated': False}

    def detect(self, edges, current):
        results = []
        incoming, outgoing = defaultdict(list), defaultdict(list)
        for edge in edges:
            source, target = endpoints(edge)
            outgoing[source].append(edge)
            incoming[target].append(edge)
        def order(edge):
            return edge['timestamp'], edge['sourceRow']
        for hub in sorted(set(incoming) | set(outgoing)):
            ins, outs = incoming[hub], outgoing[hub]
            sources = {endpoints(e)[0] for e in ins}
            targets = {endpoints(e)[1] for e in outs}
            if len(sources) >= 2 and 'FAN-IN' in self.enabled:
                results.append(self.finding('FAN-IN', [hub], ins, {hub: 'collection account'},
                    [f'{hub} received from {len(sources)} distinct accounts across {len(ins)} transfers.'], len(sources) / 5))
            if len(targets) >= 2 and 'FAN-OUT' in self.enabled:
                results.append(self.finding('FAN-OUT', [hub], outs, {hub: 'dispersal account'},
                    [f'{hub} sent to {len(targets)} distinct accounts across {len(outs)} transfers.'], len(targets) / 5))
            if len(sources) >= 2 and len(targets) >= 2 and 'GATHER-SCATTER' in self.enabled:
                # Match collection preceding dispersal; exclude cycles through source peers.
                pairs = [(i, o) for i in ins for o in outs if order(i) < order(o) and endpoints(i)[0] != endpoints(o)[1]]
                gathered = {i['id']: i for i, _ in pairs}
                dispersed = {o['id']: o for _, o in pairs}
                if len({endpoints(i)[0] for i in gathered.values()}) >= 2 and len({endpoints(o)[1] for o in dispersed.values()}) >= 2:
                    results.append(self.finding('GATHER-SCATTER', [hub], list(gathered.values()) + list(dispersed.values()),
                        {hub: 'intermediary'}, [f'{hub} collected from multiple sources before dispersing to multiple destinations.'], .7))
        if 'SCATTER-GATHER' in self.enabled:
            routes = defaultdict(list)
            for middle in sorted(set(incoming) & set(outgoing)):
                for i in incoming[middle]:
                    for o in outgoing[middle]:
                        source, dest = endpoints(i)[0], endpoints(o)[1]
                        if order(i) < order(o) and source != dest:
                            routes[(source, dest)].append((middle, i, o))
            for (source, dest), paths in sorted(routes.items()):
                middles = {p[0] for p in paths}
                if len(middles) >= 2:
                    results.append(self.finding('SCATTER-GATHER', [source, dest], [e for _, i, o in paths for e in (i, o)],
                        {source: 'origin', dest: 'consolidation destination', **{m: 'intermediary' for m in middles}},
                        [f'{source} routed transfers through {len(middles)} intermediaries to {dest}, in event-time order.'], len(middles) / 4))
        if 'BIPARTITE' in self.enabled:
            senders = sorted(outgoing)
            for index, a in enumerate(senders):
                for b in senders[index + 1:]:
                    common = ({endpoints(e)[1] for e in outgoing[a]} & {endpoints(e)[1] for e in outgoing[b]}) - {a, b}
                    if len(common) >= 2:
                        matching = [e for s in (a, b) for e in outgoing[s] if endpoints(e)[1] in common]
                        results.append(self.finding('BIPARTITE', [a, b], matching,
                            {a: 'origin', b: 'origin', **{t: 'destination' for t in common}},
                            [f'{a} and {b} both transferred to the same {len(common)} destinations (a complete 2×2 substructure).'], .6))
        # Trace time-ordered simple paths ending at the new edge. A bounded search
        # makes runtime predictable; exhaustion yields no extra findings.
        if current in edges and {'CYCLE', 'STACK'} & set(self.enabled):
            source, target = endpoints(current)
            budget = [10000]
            def walk(path, nodes):
                if budget[0] <= 0:
                    return
                budget[0] -= 1
                first = endpoints(path[0])[0]
                if len(path) >= 2 and first == target:
                    if 'CYCLE' in self.enabled:
                        results.append(self.finding('CYCLE', sorted(nodes), path,
                            {n: 'cycle participant' for n in nodes},
                            [' → '.join([endpoints(e)[0] for e in path] + [target]) + ' formed a time-ordered circular flow.'], .8))
                    return
                if len(path) == 3 and 'STACK' in self.enabled:
                    results.append(self.finding('STACK', [endpoints(path[0])[0], target], path,
                        {endpoints(path[0])[0]: 'origin', target: 'destination',
                         **{endpoints(e)[1]: 'intermediary' for e in path[:-1]}},
                        [' → '.join([endpoints(e)[0] for e in path] + [target]) + ' formed three sequential transfer links.'], .6))
                if len(path) >= 12:
                    return
                for prior in incoming[first]:
                    previous_source = endpoints(prior)[0]
                    if order(prior) < order(path[0]) and (previous_source not in nodes or previous_source == target):
                        walk([prior] + path, nodes | {previous_source})
            walk([current], {source, target})
        return results

    def correlate(self, finding, observed):
        related = []
        connections = []
        for case in self.cases:
            prior = [self.findings[key] for key in case['findingIds']]
            links = [p for p in prior if set(p['transactionIds']) & set(finding['transactionIds']) or
                     (set(p['anchors']) & set(finding['anchors']) and
                      abs(datetime.fromisoformat(observed) - datetime.fromisoformat(case['lastSeen'])) <= GRAPH_WINDOW)]
            if links:
                related.append(case)
                for prior_finding in links:
                    shared = sorted(set(prior_finding['transactionIds']) & set(finding['transactionIds']))
                    if prior_finding['id'] != finding['id']:
                        connections.append({'findingId': finding['id'], 'priorFindingId': prior_finding['id'],
                            'via': 'shared transactions' if shared else 'shared structural anchors',
                            'sharedIds': shared or sorted(set(prior_finding['anchors']) & set(finding['anchors'])),
                            'observedAt': observed})
        if related:
            case = min(related, key=lambda c: c['id'])
            for merged in related:
                if merged is not case:
                    case['findingIds'] = sorted(set(case['findingIds'] + merged['findingIds']))
                    case['mergedCaseIds'] = sorted(set(case['mergedCaseIds'] + [merged['id']] + merged['mergedCaseIds']))
                    case['timeline'] += merged['timeline']
                    case['connections'] += merged['connections']
                    self.cases.remove(merged)
        else:
            case = {'id': f'case-{len(self.findings):04d}-{finding["id"][-6:]}', 'firstSeen': observed,
                    'lastSeen': observed, 'findingIds': [], 'timeline': [], 'mergedCaseIds': [], 'connections': []}
            self.cases.append(case)
        for link in connections:
            if not any(old['findingId'] == link['findingId'] and old['priorFindingId'] == link['priorFindingId']
                       and old['via'] == link['via'] and old['sharedIds'] == link['sharedIds'] for old in case['connections']):
                case['connections'].append(link)
        case['findingIds'] = sorted(set(case['findingIds'] + [finding['id']]))
        case['lastSeen'] = observed
        all_findings = [self.findings[key] for key in case['findingIds']]
        case['transactionIds'] = sorted({t for f in all_findings for t in f['transactionIds']})
        case['typologies'] = sorted({f['typology'] for f in all_findings})
        roles = defaultdict(set)
        for f in all_findings:
            for entity in f['accountIds']:
                roles[entity].add(f['roles'].get(entity, 'counterparty'))
        case['entities'] = [{'id': key, 'roles': sorted(value), 'suspect': False} for key, value in sorted(roles.items())]
        case['severity'] = 'LOW'
        case['severityInputs'] = {'corroboratedSignals': 0, 'structuralFindings': len(all_findings),
                                  'affectedEntities': len(roles), 'typologies': case['typologies'], 'highestEntityRisk': None}
        case['severityReason'] = 'Structural evidence only; behavioural, GNN, and infrastructure corroboration are unavailable. No review escalation.'
        stage = {'FAN-IN': 'Collection', 'FAN-OUT': 'Dispersal', 'GATHER-SCATTER': 'Collection → dispersal',
                 'SCATTER-GATHER': 'Structuring → consolidation', 'CYCLE': 'Circular flow',
                 'STACK': 'Layering', 'BIPARTITE': 'Coordinated movement'}[finding['typology']]
        case['timeline'].append({'timestamp': observed, 'findingId': finding['id'], 'stage': stage,
                                 'severity': 'LOW', 'linkedTransactions': len(case['transactionIds']),
                                 'facts': finding['facts']})
        case['timeline'].sort(key=lambda t: (t['timestamp'], t['findingId']))
        case['evidence'] = all_findings

    def snapshot(self):
        return deepcopy({'status': 'ready', 'error': None, 'enabledTypologies': self.enabled,
                         'ruleWindow': '7 days', 'featureWindow': '1 hour',
                         'cases': sorted(self.cases, key=lambda c: (-len(c['findingIds']), c['id'])),
                         'entities': self.entities, 'decisions': self.decisions})
