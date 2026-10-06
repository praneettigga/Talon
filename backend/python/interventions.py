"""Pure what-if on a copied, frozen observed case graph. Never executes a hold."""
from collections import defaultdict, deque
from copy import deepcopy

from .engine import endpoints

LABEL = 'Observed-route disruption; assumes similar routes recur.'
ROUTE_LIMIT = 50


def reachable(edges, sources):
    outgoing = defaultdict(list)
    for edge in edges:
        outgoing[endpoints(edge)[0]].append(edge)
    for values in outgoing.values():
        values.sort(key=lambda e: (endpoints(e)[1], e['timestamp'], e['sourceRow']))
    paths = {source: {'destination': source, 'accountIds': [source], 'transactionIds': []} for source in sources}
    queue = deque(sources)
    while queue:
        source = queue.popleft()
        for edge in outgoing[source]:
            target = endpoints(edge)[1]
            if target not in paths:
                prior = paths[source]
                paths[target] = {'destination': target, 'accountIds': prior['accountIds'] + [target],
                                 'transactionIds': prior['transactionIds'] + [edge['id']]}
                queue.append(target)
    return {key: value for key, value in paths.items() if key not in sources}


def scenario(name, edges, sources, held, baseline, entities):
    held = sorted(set(held))
    removed = [e for e in edges if endpoints(e)[0] in held]
    remaining = [e for e in edges if endpoints(e)[0] not in held]
    interrupted = {e['id'] for e in removed}
    paths = reachable(remaining, sources)
    lost = sorted(set(baseline) - set(paths))
    routes = [{**path, 'alternateToInterruptedBaseline': bool(set(baseline[target]['transactionIds']) & interrupted)}
              for target, path in paths.items()]
    routes.sort(key=lambda p: (not p['alternateToInterruptedBaseline'], p['destination']))
    touched = sorted(set(held) | {a for edge in removed for a in endpoints(edge)})
    role_map = {e['id']: e['roles'] for e in entities}
    return {'name': name, 'heldAccountIds': held, 'interruptedTransferIds': sorted(interrupted),
            'interruptedTransferCount': len(removed), 'remainingTransferIds': [e['id'] for e in remaining],
            'remainingTransferCount': len(remaining), 'noLongerReachableAccountIds': lost,
            'reachableAccountIds': sorted(paths), 'directlyTouchedAccountIds': touched,
            'touchedCounterpartyIds': [a for a in touched if 'counterparty' in role_map.get(a, [])],
            'remainingRouteCount': len(routes), 'remainingAlternateRouteCount': sum(r['alternateToInterruptedBaseline'] for r in routes),
            'remainingRoutes': routes[:ROUTE_LIMIT], 'routesTruncated': len(routes) > ROUTE_LIMIT}


def simulate(request):
    case = deepcopy(request['case'])
    wanted = set(case['transactionIds'])
    # Only passed, already committed transfers. No engine/model/enrichment state used.
    edges = sorted([deepcopy(e) for e in request['events'] if e['id'] in wanted],
                   key=lambda e: (e['timestamp'], e['sourceRow']))
    if not edges or {e['id'] for e in edges} != wanted:
        raise ValueError('Case evidence does not match frozen observed transfers')
    if any(e['timestamp'] > request['observedAt'] for e in edges):
        raise ValueError('Future transfer in simulation snapshot')
    accounts = {a for e in edges for a in endpoints(e)}
    for values in [request['heldAccountIds'], request.get('compareHeldAccountIds'), request.get('sourceAccountIds')]:
        if values is not None and (not values or len(values) != len(set(values)) or not set(values) <= accounts):
            raise ValueError('Simulation accounts must be unique members of the observed case')
    comparison = request.get('compareHeldAccountIds')
    if comparison is not None and not set(request['heldAccountIds']) <= set(comparison):
        raise ValueError('Comparison hold set must include the initial hold set')
    sources = request.get('sourceAccountIds')
    if sources:
        policy = 'Investigator-selected observed case sources.'
    else:
        outgoing = {endpoints(e)[0] for e in edges}
        incoming = {endpoints(e)[1] for e in edges}
        sources = sorted(outgoing - incoming)
        policy = 'Accounts with outgoing transfers and no incoming transfers in this case.'
        if not sources:
            sources = [endpoints(edges[0])[0]]
            policy = 'No zero-in-degree source; earliest observed transfer sender used as the cycle entry point.'
    sources = sorted(sources)
    baseline = reachable(edges, sources)
    scenarios = [scenario('initial', edges, sources, request['heldAccountIds'], baseline, case['entities'])]
    if comparison is not None:
        scenarios.append(scenario('comparison', edges, sources, comparison, baseline, case['entities']))
    delta = None
    if len(scenarios) == 2:
        first, second = scenarios
        delta = {'additionalInterruptedTransferIds': sorted(set(second['interruptedTransferIds']) - set(first['interruptedTransferIds'])),
                 'additionalUnreachableAccountIds': sorted(set(second['noLongerReachableAccountIds']) - set(first['noLongerReachableAccountIds']))}
    return {'status': 'ready', 'caseId': case['id'], 'snapshotCursor': request['snapshotCursor'],
            'observedAt': request['observedAt'], 'label': LABEL, 'sourceAccountIds': sources, 'sourcePolicy': policy,
            'baseline': {'transferCount': len(edges), 'accountCount': len(accounts), 'reachableAccountIds': sorted(baseline)},
            'scenarios': scenarios, 'comparison': delta,
            'method': 'Directed reachability on observed transfers; ignores temporal ordering. One shortest route witness per reachable destination, at most 50 shown. Synthetic infrastructure is not a transfer route.'}
