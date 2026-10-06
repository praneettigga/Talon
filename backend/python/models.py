"""CPU IBM GIN, Isolation Forest and XGBoost inference on observed prefixes only."""
from datetime import datetime
import hashlib
import importlib.metadata
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
import torch
import xgboost as xgb

from .engine import endpoints
from .signals import behaviour_vector, fusion_vector, FUSION_NAMES
from .vendor.gin import GINe

MODEL_VERSION = 'talon-m4-v1'
GIN_CONFIG = {'num_features': 1, 'num_gnn_layers': 2, 'n_hidden': 16,
              'edge_updates': True, 'final_dropout': 0.0}
torch.set_num_threads(1)


class Behaviour:
    def fit(self, records, labels):
        groups = {}
        for record, label in zip(records, labels):
            if label != 0:
                continue
            for feature in record['features']:
                if feature['historyCount'] >= 5:
                    groups.setdefault(feature['currency'], []).append(behaviour_vector(feature))
        self.models = {}
        for currency, values in sorted(groups.items()):
            if len(values) < 32:
                continue
            model = IsolationForest(n_estimators=64, max_samples=min(256, len(values)),
                                    random_state=42, n_jobs=1).fit(values)
            self.models[currency] = (model, np.sort(-model.score_samples(values)))
        if not self.models:
            raise ValueError('No currency has 32 benign snapshots with five prior observations')
        return self

    def scores(self, records):
        results = [[None, None] for _ in records]
        groups = {}
        for index, record in enumerate(records):
            for side, feature in enumerate(record['features']):
                if feature['historyCount'] >= 5 and feature['currency'] in self.models:
                    groups.setdefault(feature['currency'], []).append((index, side, behaviour_vector(feature)))
        for currency, samples in groups.items():
            model, reference = self.models[currency]
            raw = -model.score_samples([s[2] for s in samples])
            scores = np.searchsorted(reference, raw, side='right') / len(reference)
            for (index, side, _), score in zip(samples, scores):
                results[index][side] = float(score)
        return results


class GraphEncoder:
    def fit(self, records):
        events = [r['event'] for r in records]
        self.origin = min(e['timestamp'] for e in events)
        self.currencies = sorted({e['receivingCurrency'] for e in events})
        self.formats = sorted({e['paymentFormat'] for e in events})
        # Statistics are fit exclusively on the upstream training prefix.
        amounts = np.log1p([float(e['amountReceived']) for e in events])
        self.mean, self.std = float(amounts.mean()), max(float(amounts.std()), 1e-6)
        return self

    @property
    def edge_dim(self):
        return 2 + len(self.currencies) + 1 + len(self.formats) + 1

    def encode(self, record):
        graph = record['graph']
        nodes = sorted({a for e in graph for a in endpoints(e)})
        ids = {a: index for index, a in enumerate(nodes)}
        now = datetime.fromisoformat(record['event']['timestamp'])
        attributes, edges = [], []
        for e in graph:
            # Relative edge age, normalized log amount and one-hot categories.
            age = (now - datetime.fromisoformat(e['timestamp'])).total_seconds() / (7 * 86400)
            cur = self.currencies.index(e['receivingCurrency']) if e['receivingCurrency'] in self.currencies else len(self.currencies)
            fmt = self.formats.index(e['paymentFormat']) if e['paymentFormat'] in self.formats else len(self.formats)
            attributes.append([age, (np.log1p(float(e['amountReceived'])) - self.mean) / self.std] +
                              [float(i == cur) for i in range(len(self.currencies) + 1)] +
                              [float(i == fmt) for i in range(len(self.formats) + 1)])
            edges.append([ids[a] for a in endpoints(e)])
        target = next(i for i, e in enumerate(graph) if e['id'] == record['event']['id'])
        return (torch.ones((len(nodes), 1)), torch.tensor(edges, dtype=torch.long).T,
                torch.tensor(attributes, dtype=torch.float32), target)

    def state(self):
        return vars(self)

    @classmethod
    def restore(cls, state):
        obj = cls(); obj.__dict__.update(state); return obj


def batch_graphs(graphs):
    nodes, edges, attrs, targets = [], [], [], []
    node_offset = edge_offset = 0
    for x, edge_index, edge_attr, target in graphs:
        nodes.append(x); edges.append(edge_index + node_offset); attrs.append(edge_attr)
        targets.append(target + edge_offset)
        node_offset += x.shape[0]; edge_offset += edge_attr.shape[0]
    return torch.cat(nodes), torch.cat(edges, dim=1), torch.cat(attrs), torch.tensor(targets)


def gin_scores(model, encoder, records):
    model.eval()
    scores = []
    with torch.no_grad():
        for start in range(0, len(records), 32):
            x, edges, attrs, targets = batch_graphs([encoder.encode(r) for r in records[start:start + 32]])
            scores.extend(model(x, edges, attrs)[targets].softmax(dim=1)[:, 1].tolist())
    return scores


def fit_gin(records, labels, epochs=8):
    torch.manual_seed(42)
    encoder = GraphEncoder().fit(records)
    model = GINe(**GIN_CONFIG, edge_dim=encoder.edge_dim)
    # Fixed hash subsample bounds CPU fitting, without consulting validation/test.
    ranked = sorted(range(len(records)), key=lambda i: hashlib.sha256(records[i]['event']['id'].encode()).hexdigest())[:2048]
    graphs = [encoder.encode(records[i]) for i in ranked]
    ys = torch.tensor([labels[i] for i in ranked], dtype=torch.long)
    if len(set(ys.tolist())) != 2:
        raise ValueError('GIN prefix must contain both classes')
    counts = torch.bincount(ys, minlength=2).float()
    loss_fn = torch.nn.CrossEntropyLoss(weight=len(ys) / (2 * counts))
    optimizer = torch.optim.Adam(model.parameters(), lr=.003)
    for _ in range(epochs):
        model.train()
        for begin in range(0, len(graphs), 32):
            x, edges, attrs, targets = batch_graphs(graphs[begin:begin + 32])
            optimizer.zero_grad()
            loss = loss_fn(model(x, edges, attrs)[targets], ys[begin:begin + 32])
            loss.backward(); optimizer.step()
    model.eval()
    return model, encoder


def upstream(behaviour, gin, encoder, records):
    behaviour_scores = behaviour.scores(records)
    relational = gin_scores(gin, encoder, records)
    vectors = []
    for record, sides, graph_score in zip(records, behaviour_scores, relational):
        available = [s for s in sides if s is not None]
        anomaly = max(available) if available else None
        vectors.append(fusion_vector(record['features'], anomaly, graph_score, record['rules']))
    return np.array(vectors, dtype=np.float32), behaviour_scores, relational


def empty_models(error='Models not prepared. Run npm run models:prepare and npm run models:train.'):
    return {'status': 'unavailable', 'error': error, 'version': None, 'graphModel': 'IBM Multi-GNN GIN',
            'availableFrom': None, 'reviewThreshold': None, 'evaluation': None}


class ModelRunner:
    def __init__(self, directory, source_sha, enabled):
        directory = Path(directory)
        metadata = json.loads((directory / 'metadata.json').read_text())
        if metadata['version'] != MODEL_VERSION or metadata['sourceSha256'] != source_sha:
            raise ValueError('Model version/source hash mismatch')
        if metadata['enabledTypologies'] != sorted(enabled) or metadata['featureNames'] != FUSION_NAMES:
            raise ValueError('Model rule vocabulary/preprocessing mismatch')
        for package, expected in metadata['dependencies'].items():
            if importlib.metadata.version(package) != expected:
                raise ValueError(f'Model dependency version mismatch: {package}; install the pinned backend requirements')
        for name, expected in metadata['artifactHashes'].items():
            if hashlib.sha256((directory / name).read_bytes()).hexdigest() != expected:
                raise ValueError(f'Model artifact checksum mismatch: {name}')
        self.metadata = metadata
        # Locally generated joblib artifact; never load externally supplied pickle files.
        self.behaviour = joblib.load(directory / 'behaviour.joblib')
        self.encoder = GraphEncoder.restore(metadata['graphEncoder'])
        self.gin = GINe(**GIN_CONFIG, edge_dim=self.encoder.edge_dim)
        self.gin.load_state_dict(torch.load(directory / 'gin.pt', map_location='cpu', weights_only=True))
        self.gin.eval()
        self.fusion = xgb.Booster(); self.fusion.load_model(directory / 'fusion.json')
        self.status = {'status': 'ready', 'error': None, 'version': MODEL_VERSION,
                       'graphModel': 'IBM Multi-GNN GIN', 'availableFrom': metadata['availableFrom'],
                       'reviewThreshold': metadata['reviewThreshold'], 'evaluation': metadata['evaluation']}

    def score(self, record):
        event = record['event']
        base = {'transactionId': event['id'], 'asOf': event['timestamp'], 'riskScore': None,
                'behaviourScore': None, 'ginScore': None, 'behaviourByAccount': {},
                'contributions': [], 'rawMargin': None, 'baseMargin': None, 'inputs': {},
                'ruleScores': record['rules'], 'modelVersion': MODEL_VERSION}
        if event['timestamp'] < self.metadata['availableFrom']:
            return {**base, 'status': 'historical warmup', 'reason': 'Event precedes frozen model/calibration cutoff; no retrospective learned score.'}
        vectors, sides, graph = upstream(self.behaviour, self.gin, self.encoder, [record])
        matrix = xgb.DMatrix(vectors, feature_names=FUSION_NAMES)
        margin = float(self.fusion.predict(matrix, output_margin=True)[0])
        coefficients = self.metadata['calibration']
        z = np.clip(coefficients['slope'] * margin + coefficients['intercept'], -40, 40)
        risk = float(100 / (1 + np.exp(-z)))
        contribs = self.fusion.predict(matrix, pred_contribs=True)[0]
        available = [s for s in sides[0] if s is not None]
        return {**base, 'status': 'scored', 'reason': 'Calibrated transaction score on an observed temporal prefix; not a certain fraud probability.',
                'riskScore': round(risk, 4), 'behaviourScore': max(available) if available else None,
                'behaviourByAccount': {f['accountId']: s for f, s in zip(record['features'], sides[0])},
                'ginScore': round(graph[0], 6), 'rawMargin': margin, 'baseMargin': float(contribs[-1]),
                'inputs': dict(zip(FUSION_NAMES, vectors[0].tolist())),
                'contributions': [{'feature': name, 'value': float(value)} for name, value in zip(FUSION_NAMES, contribs[:-1])]}
