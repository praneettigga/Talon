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
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            command = request['command']
            if command == 'init':
                manifest = json.loads(Path(request['manifest']).read_text())
                if manifest['files']['HI-Small_Trans.csv']['sha256'] != request['sourceSha256']:
                    raise ValueError('Replay source hash does not match validated manifest')
                enabled = manifest['enabled_typologies']
                if any(t not in SUPPORTED or t not in manifest['typology_attempts'] for t in enabled):
                    raise ValueError('Manifest contains unverified typologies')
                try:
                    from .models import ModelRunner
                    models = ModelRunner(request['modelsDirectory'], request['sourceSha256'], enabled)
                    model_error = None
                except Exception as error:
                    models = None
                    model_error = f'Models unavailable: {error}'
                engine = Engine(enabled, models, model_error)
                result = engine.snapshot()
            elif engine is None:
                raise ValueError('Worker has not been initialized')
            elif command == 'reset':
                engine = Engine(enabled, models, model_error)
                result = engine.snapshot()
            elif command == 'event':
                # The service sends runtime fields only. No ground truth is loaded.
                result = engine.process(request['event'])
            else:
                raise ValueError('Unknown worker command')
            response = {'id': request['id'], 'result': result}
        except Exception as error:
            response = {'id': request.get('id'), 'error': str(error)}
        print(json.dumps(response, allow_nan=False, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
