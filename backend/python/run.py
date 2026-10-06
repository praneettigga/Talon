"""Run a Python command using this repository's model environment when present."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
local = ROOT / '.venv/bin/python'
executable = os.environ.get('TALON_PYTHON') or (str(local) if local.exists() else sys.executable)
raise SystemExit(subprocess.call([executable, *sys.argv[1:]], cwd=ROOT))
