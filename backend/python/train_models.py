"""Forward-chained training, validation-only calibration and frozen test evaluation."""
import argparse
import csv
from datetime import datetime
import hashlib
import importlib.metadata
import json
from pathlib import Path
import shutil
import tempfile

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, confusion_matrix
import torch
import xgboost as xgb

from pipeline.data import ROOT, write_manifest
from .engine import endpoints
from .models import Behaviour, fit_gin, upstream, MODEL_VERSION
from .signals import extract, FUSION_NAMES


def metrics(labels, scores, threshold, eligible=None):
    y = np.asarray(labels); scores = np.asarray(scores)
    predicted = scores >= threshold
    if eligible is not None:
        predicted &= np.asarray(eligible)
    tn, fp, fn, tp = confusion_matrix(y, predicted, labels=[0, 1]).ravel()
    return {'rows': len(y), 'positives': int(y.sum()), 'threshold': threshold,
            'precision': float(tp / (tp + fp)) if tp + fp else None,
            'recall': float(tp / (tp + fn)) if tp + fn else None,
            'prAuc': float(average_precision_score(y, scores)) if y.sum() and (y == 0).any() else None,
            'falsePositiveRate': float(fp / (tn + fp)) if tn + fp else None,
            'confusion': {'tn': int(tn), 'fp': int(fp), 'fn': int(fn), 'tp': int(tp)},
            'brierScore': float(brier_score_loss(y, scores / 100))}


def choose_threshold(labels, scores, eligible, target=.01):
    # Lowest threshold satisfying the FPR target on the threshold-selection window.
    # 100.0001 explicitly permits no reviews when validation cannot support them.
    options = sorted(set(float(s) for s, ok in zip(scores, eligible) if ok) | {100.0001})
    for threshold in options:
        measured = metrics(labels, scores, threshold, eligible)
        if measured['falsePositiveRate'] is not None and measured['falsePositiveRate'] <= target:
            return threshold
    raise ValueError('Threshold window needs benign examples')


def corroboration(record, sides, graph):
    return any(record['rules'].values()) and (graph >= .8 or any(s is not None and s >= .99 for s in sides))


def export_ibm(records, labels, path):
    nodes = sorted({a for r in records for a in endpoints(r['event'])})
    ids = {node: n for n, node in enumerate(nodes)}
    origin = datetime.fromisoformat(records[0]['event']['timestamp'])
    currencies = sorted({r['event']['receivingCurrency'] for r in records})
    formats = sorted({r['event']['paymentFormat'] for r in records})
    with path.open('w', newline='') as target:
        writer = csv.writer(target)
        writer.writerow(['EdgeID', 'from_id', 'to_id', 'Timestamp', 'Amount Received', 'Received Currency', 'Payment Format', 'Is Laundering'])
        for record, label in zip(records, labels):
            e = record['event']; a, b = endpoints(e)
            writer.writerow([e['sourceRow'], ids[a], ids[b], int((datetime.fromisoformat(e['timestamp']) - origin).total_seconds()),
                             e['amountReceived'], currencies.index(e['receivingCurrency']), formats.index(e['paymentFormat']), label])


def train(dataset_dir, output_dir, report_path, epochs=8):
    source = json.loads((dataset_dir / 'events.json').read_text())
    labels_by_id = json.loads((dataset_dir / 'labels.json').read_text())
    events, dataset = source['events'], source['metadata']
    manifest = json.loads((ROOT / 'docs/data/hi-small-manifest.json').read_text())
    if dataset['sourceSha256'] != manifest['files']['HI-Small_Trans.csv']['sha256']:
        raise ValueError('Dataset source checksum mismatch')
    enabled = sorted(manifest['enabled_typologies'])
    labels = np.array([labels_by_id[e['id']] for e in events])
    if set(labels.tolist()) != {0, 1}:
        raise ValueError('Model dataset needs both classes')
    print(f'Extracting observed-prefix features/graphs for {len(events)} events', flush=True)
    records = extract(events, enabled)
    start = datetime.fromisoformat(dataset['start'])
    end = datetime.fromisoformat(dataset['split']['end'])
    boundaries = [(start + (end - start) * fraction).isoformat() for fraction in [.2, .4, .6]]
    train_end, val_end = dataset['split']['trainEnd'], dataset['split']['validationEnd']
    oof_x, oof_y, folds = [], [], []
    for begin, finish in zip(boundaries[:-1], boundaries[1:]):
        fit_ids = [i for i, e in enumerate(events) if e['timestamp'] < begin]
        score_ids = [i for i, e in enumerate(events) if begin <= e['timestamp'] < finish]
        if not fit_ids or not score_ids:
            raise ValueError('Empty forward fold')
        fitting = [records[i] for i in fit_ids]
        print(f'Forward fold: {len(fit_ids)} upstream-fit → {len(score_ids)} unseen outputs', flush=True)
        behaviour = Behaviour().fit(fitting, labels[fit_ids])
        gin, encoder = fit_gin(fitting, labels[fit_ids], epochs)
        vectors, _, _ = upstream(behaviour, gin, encoder, [records[i] for i in score_ids])
        oof_x.extend(vectors); oof_y.extend(labels[score_ids])
        folds.append({'upstreamFitRows': len(fit_ids), 'fusionRows': len(score_ids),
                      'maxFitLabelTime': events[fit_ids[-1]]['timestamp'],
                      'firstFusionTime': events[score_ids[0]]['timestamp'], 'endExclusive': finish})
    print('Fitting XGBoost on forward-only upstream outputs', flush=True)
    fusion = xgb.train({'objective': 'binary:logistic', 'max_depth': 3, 'eta': .08,
                        'subsample': 1, 'colsample_bytree': 1, 'seed': 42, 'nthread': 1,
                        'tree_method': 'hist', 'eval_metric': 'logloss'},
                       xgb.DMatrix(np.asarray(oof_x), label=oof_y, feature_names=FUSION_NAMES), num_boost_round=64)
    train_ids = [i for i, e in enumerate(events) if e['timestamp'] < train_end]
    val_ids = [i for i, e in enumerate(events) if train_end <= e['timestamp'] < val_end]
    test_ids = [i for i, e in enumerate(events) if val_end <= e['timestamp'] < dataset['split']['end']]
    for ids in [train_ids, val_ids, test_ids]:
        if set(labels[ids].tolist()) != {0, 1}:
            raise ValueError('Every temporal partition must contain both classes')
    print(f'Fitting final upstream artifacts on {len(train_ids)} training events', flush=True)
    fitting = [records[i] for i in train_ids]
    behaviour = Behaviour().fit(fitting, labels[train_ids])
    gin, encoder = fit_gin(fitting, labels[train_ids], epochs)
    val_x, val_sides, val_gin = upstream(behaviour, gin, encoder, [records[i] for i in val_ids])
    val_margin = fusion.predict(xgb.DMatrix(val_x, feature_names=FUSION_NAMES), output_margin=True)
    middle = (datetime.fromisoformat(train_end) + (datetime.fromisoformat(val_end) - datetime.fromisoformat(train_end)) / 2).isoformat()
    cal = [j for j, i in enumerate(val_ids) if events[i]['timestamp'] < middle]
    threshold_ids = [j for j, i in enumerate(val_ids) if events[i]['timestamp'] >= middle]
    if set(labels[np.array(val_ids)[cal]].tolist()) != {0, 1}:
        raise ValueError('Calibration half needs both classes')
    calibration = LogisticRegression(C=1, random_state=42).fit(val_margin[cal].reshape(-1, 1), labels[np.array(val_ids)[cal]])
    val_scores = calibration.predict_proba(val_margin.reshape(-1, 1))[:, 1] * 100
    val_eligible = [corroboration(records[i], sides, score) for i, sides, score in zip(val_ids, val_sides, val_gin)]
    threshold = choose_threshold(labels[np.array(val_ids)[threshold_ids]], val_scores[threshold_ids],
                                 [val_eligible[j] for j in threshold_ids])
    print(f'Frozen review threshold {threshold:.4f}; evaluating untouched final test window', flush=True)
    test_x, test_sides, test_gin = upstream(behaviour, gin, encoder, [records[i] for i in test_ids])
    test_margin = fusion.predict(xgb.DMatrix(test_x, feature_names=FUSION_NAMES), output_margin=True)
    test_scores = calibration.predict_proba(test_margin.reshape(-1, 1))[:, 1] * 100
    eligible = [corroboration(records[i], sides, score) for i, sides, score in zip(test_ids, test_sides, test_gin)]
    evaluated = metrics(labels[test_ids], test_scores, threshold)
    reviewed = metrics(labels[test_ids], test_scores, threshold, eligible)
    report = {'schemaVersion': 1, 'modelVersion': MODEL_VERSION, 'dataset': dataset,
              'protocolNotes': 'A 14-day exploratory envelope had only two benign test examples and was rejected for FPR evaluation. The fixed 10-day envelope has class support across partitions; final model settings were not tuned on test performance.',
              'prAucDefinition': 'Average precision (step-wise PR integral), using unfiltered transaction-risk ranking.',
              'split': {'train': {'rows': len(train_ids), 'positives': int(labels[train_ids].sum()), 'endExclusive': train_end},
                        'validation': {'rows': len(val_ids), 'positives': int(labels[val_ids].sum()), 'endExclusive': val_end},
                        'test': {'rows': len(test_ids), 'positives': int(labels[test_ids].sum()), 'endExclusive': dataset['split']['end']}},
              'forwardFolds': folds, 'gin': {'implementation': 'IBM Multi-GNN GINe',
                'commit': '252b0252afca109d1d216c411c59ff70753b25fc', 'epochs': epochs,
                'layers': 2, 'hidden': 16, 'fitSnapshotCap': 2048, 'snapshotEdgeCap': 128, 'hops': 2},
              'calibration': {'method': 'Platt logistic scaling on first validation half', 'endExclusive': middle,
                              'slope': float(calibration.coef_[0, 0]), 'intercept': float(calibration.intercept_[0])},
              'thresholdSelection': {'windowStart': middle, 'windowEndExclusive': val_end, 'targetFalsePositiveRate': .01,
                  'reviewThreshold': threshold, 'metrics': metrics(labels[np.array(val_ids)[threshold_ids]], val_scores[threshold_ids],
                      threshold, [val_eligible[j] for j in threshold_ids])},
              'test': evaluated, 'testReviewGate': reviewed,
              'behaviourCurrencies': {c: len(reference) for c, (_, reference) in behaviour.models.items()},
              'limitations': ['Bounded case-enriched synthetic subset, not full-benchmark estimates.',
                             'GIN predicts on two-hop observed prefixes, not the full IBM experiment configuration.',
                             'Sparse histories often leave behavioural scores unavailable.',
                             'Entity time-decayed risk and case severity are prioritisation heuristics, not calibrated probabilities.',
                             'No synthetic enrichment; account age unavailable. Case-reconstruction evaluation is a later milestone.']}
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='talon-models-', dir=output_dir.parent))
    try:
        joblib.dump(behaviour, staging / 'behaviour.joblib')
        torch.save(gin.state_dict(), staging / 'gin.pt')
        fusion.save_model(staging / 'fusion.json')
        hashes = {name: hashlib.sha256((staging / name).read_bytes()).hexdigest()
                  for name in ['behaviour.joblib', 'gin.pt', 'fusion.json']}
        report['artifactHashes'] = hashes
        metadata = {'version': MODEL_VERSION, 'sourceSha256': dataset['sourceSha256'], 'enabledTypologies': enabled,
                    'availableFrom': val_end, 'reviewThreshold': threshold, 'featureNames': FUSION_NAMES,
                    'graphEncoder': encoder.state(), 'calibration': report['calibration'],
                    'artifactHashes': hashes, 'evaluation': report,
                    'dependencies': {p: importlib.metadata.version(p) for p in ['numpy', 'scikit-learn', 'xgboost', 'torch', 'torch-geometric']}}
        write_manifest(metadata, staging / 'metadata.json')
        # ModelRunner validates all staged artifacts before publishing a replacement.
        from .models import ModelRunner
        ModelRunner(staging, dataset['sourceSha256'], enabled)
        previous = output_dir.with_name(output_dir.name + '-previous')
        if previous.exists():
            shutil.rmtree(previous)
        if output_dir.exists():
            output_dir.rename(previous)
        staging.rename(output_dir)
        write_manifest(report, report_path)
        export_ibm(records, labels, dataset_dir / 'formatted_transactions.csv')
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    print(json.dumps({'test': evaluated, 'reviewGate': reviewed, 'artifacts': str(output_dir)}, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-dir', type=Path, default=ROOT / 'data/models/dataset')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data/models/current')
    parser.add_argument('--report', type=Path, default=ROOT / 'docs/data/milestone4-evaluation.json')
    parser.add_argument('--epochs', type=int, default=8)
    args = parser.parse_args()
    train(args.dataset_dir, args.output_dir, args.report, args.epochs)


if __name__ == '__main__':
    main()
