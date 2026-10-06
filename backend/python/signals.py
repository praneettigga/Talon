"""Shared offline/live preprocessing. No labels or pattern metadata accepted here."""
import math

from .engine import Engine, GRAPH_WINDOW, SUPPORTED, endpoints, stamp

RULES = sorted(SUPPORTED)
BEHAVIOUR_NAMES = ['incomingCount', 'outgoingCount', 'incomingTotal', 'outgoingTotal',
                   'fanInDegree', 'fanOutDegree', 'fiveMinuteVelocity', 'oneHourVelocity',
                   'amountMean', 'amountDeviation', 'amountZScore', 'forwardingRatio',
                   'incomingOutgoingRatio', 'newCounterpartyRate', 'historyCount']
FUSION_NAMES = ['behaviour', 'behaviourAvailable', 'gin'] + ['rule_' + r for r in RULES] + [
    'historyCount', 'velocity', 'fanIn', 'fanOut', 'amountZScore', 'forwardingRatio', 'newCounterpartyRate']
MAX_GRAPH_EDGES = 128


def numeric(value):
    value = float(value or 0)
    if not math.isfinite(value):
        raise ValueError('Non-finite model feature')
    return math.log1p(min(max(value, 0), 1e15))


def behaviour_vector(feature):
    # Currency-specific amounts/ratios; no IDs, labels, rules or graph outputs.
    return [numeric(feature[name]) for name in BEHAVIOUR_NAMES]


def fusion_vector(features, behaviour, gin, rules):
    return [behaviour or 0, float(behaviour is not None), gin] + [rules.get(r, 0) for r in RULES] + [
        numeric(max(f['historyCount'] for f in features)),
        numeric(max(f['oneHourVelocity'] for f in features)),
        numeric(max(f['fanInDegree'] for f in features)),
        numeric(max(f['fanOutDegree'] for f in features)),
        numeric(max(f['amountZScore'] or 0 for f in features)),
        numeric(max(f['forwardingRatio'] or 0 for f in features)),
        max(f['newCounterpartyRate'] for f in features)]


def graph_snapshot(events, current, limit=MAX_GRAPH_EDGES):
    """Two-hop, seven-day graph, newest edges first for bounding; current edge retained."""
    now = stamp(current)
    active = [e for e in events if now - GRAPH_WINDOW <= stamp(e) <= now
              and (e['timestamp'], e['sourceRow']) <= (current['timestamp'], current['sourceRow'])]
    frontier = set(endpoints(current))
    selected = {}
    for _ in range(2):
        candidates = [e for e in reversed(active) if frontier.intersection(endpoints(e))]
        next_frontier = set()
        for edge in candidates:
            if len(selected) >= limit and edge['id'] not in selected:
                continue
            selected[edge['id']] = edge
            next_frontier.update(endpoints(edge))
        frontier |= next_frontier
    return sorted(selected.values(), key=lambda e: (e['timestamp'], e['sourceRow']))


def rule_signals(engine, graph, current):
    strengths = {r: 0.0 for r in RULES}
    for finding in engine.detect([e for e in graph if endpoints(e)[0] != endpoints(e)[1]], current):
        if finding['typology'] in engine.enabled and current['id'] in finding['transactionIds']:
            strengths[finding['typology']] = max(strengths[finding['typology']], finding['strength'])
    return strengths


def extract(events, enabled):
    """Prior-event features + current-prefix graph; fit code supplies labels separately."""
    engine = Engine(enabled)
    records = []
    for event in events:
        now = stamp(event)
        sender, receiver = endpoints(event)
        features = [engine.features(sender, event['paymentCurrency'], event['amountPaid'], receiver, now),
                    engine.features(receiver, event['receivingCurrency'], event['amountReceived'], sender, now)]
        engine.events.append(event)
        for entity in {sender, receiver}:
            engine.account_events[entity].append(event)
        graph = graph_snapshot(engine.events, event)
        records.append({'event': event, 'features': features, 'graph': graph,
                        'rules': rule_signals(engine, graph, event)})
    return records
