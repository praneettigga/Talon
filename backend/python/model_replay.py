"""Prepare a later demo; preserve the original early demo via data:replay."""
import json

from pipeline.data import ROOT, write_manifest
from pipeline.replay import build


def main():
    manifest = json.loads((ROOT / 'docs/data/hi-small-manifest.json').read_text())
    metadata = json.loads((ROOT / 'data/models/current/metadata.json').read_text())
    if manifest['files']['HI-Small_Trans.csv']['sha256'] != metadata['sourceSha256']:
        raise ValueError('Model source mismatch')
    payload, provenance = build(ROOT / 'data/raw/amlworld', manifest, selection='latest')
    provenance['model_scoring_cutoff'] = metadata['availableFrom']
    provenance['purpose'] = 'Curated later demonstration, not model evaluation. Score only at/after frozen calibration cutoff.'
    write_manifest(provenance, ROOT / 'data/replay/provenance.json')
    write_manifest(payload, ROOT / 'data/replay/replay.json')
    from .prepare_enrichment import prepare
    prepare(ROOT / 'data/replay/replay.json', ROOT / 'data/replay/talon_device_context.csv')
    scored = sum(e['timestamp'] >= metadata['availableFrom'] for e in payload['events'])
    print(f'Prepared {len(payload["events"])} later demo events; {scored} at/after scoring cutoff {metadata["availableFrom"]}. Restart the API.')


if __name__ == '__main__':
    main()
