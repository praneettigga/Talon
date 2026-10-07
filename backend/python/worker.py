"""Persistent NDJSON process; stdout contains protocol responses only."""
import json
from pathlib import Path
import sys

from .engine import Engine, SUPPORTED


def main():
    engine = None
    enabled = []
    models = None
    model_error = None
    enrichment = None
    enrichment_error = None
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            command = request['command']
            if command == 'init':
                if request.get('manifest'):
                    manifest = json.loads(Path(request['manifest']).read_text())
                    transaction_file = next(name for name in manifest['files'] if name.endswith('_Trans.csv'))
                    if manifest['files'][transaction_file]['sha256'] != request['sourceSha256']:
                        raise ValueError('Replay source hash does not match validated manifest')
                    enabled = manifest['enabled_typologies']
                    if any(t not in SUPPORTED or t not in manifest['typology_attempts'] for t in enabled):
                        raise ValueError('Manifest contains unverified typologies')
                else:
                    enabled = [name for name in request.get('enabledTypologies', []) if name in SUPPORTED]
                    if not enabled:
                        raise ValueError('Uploaded dataset has no supported laundering typologies')
                try:
                    from .models import ModelRunner
                    models = ModelRunner(request['modelsDirectory'], request['sourceSha256'], enabled)
                    model_error = None
                except Exception as error:
                    models = None
                    model_error = f'Models unavailable: {error}'
                try:
                    from .enrichment import Enrichment
                    if request.get('manifest'):
                        enrichment = Enrichment(request['enrichmentPath'], request.get('replaySha256'), request['sourceSha256'])
                        enrichment_error = None
                    else:
                        enrichment = None
                        enrichment_error = 'Synthetic context unavailable for uploaded datasets.'
                except Exception as error:
                    enrichment = None
                    enrichment_error = f'Synthetic context unavailable: {error}'
                engine = Engine(enabled, models, model_error, enrichment, enrichment_error)
                result = engine.snapshot()
            elif engine is None:
                raise ValueError('Worker has not been initialized')
            elif command == 'reset':
                engine = Engine(enabled, models, model_error, enrichment, enrichment_error)
                result = engine.snapshot()
            elif command == 'event':
                # The service sends runtime fields only. No ground truth is loaded.
                result = engine.process(request['event'])
            elif command == 'simulate':
                from .interventions import simulate
                result = simulate(request['snapshot'])
            else:
                raise ValueError('Unknown worker command')
            response = {'id': request['id'], 'result': result}
        except Exception as error:
            response = {'id': request.get('id'), 'error': str(error)}
        print(json.dumps(response, allow_nan=False, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
