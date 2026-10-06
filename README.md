# Talon — Financial Fraud Intelligence

Talon is being built to reconstruct explainable laundering cases from transaction networks.
Milestones 1–2 provide validated data preparation and a working transaction replay with
a live feed and directed graph. Rules, risk scoring, cases, and intervention simulation
are later milestones.

## Requirements and setup

- Node.js 22.12+ and npm (verified locally with Node 26).
- Python 3.11+ with `venv`/pip for the Kaggle CLI. Profiling and tests use only the standard library.
- Kaggle legacy API credentials for automated download, or a manually downloaded Kaggle ZIP.

```bash
npm ci
python -m venv .venv
.venv/bin/python -m pip install -r pipeline/requirements.txt
```

Obtain **Legacy API Credentials** from [Kaggle Settings → API](https://www.kaggle.com/settings/api).
Export `KAGGLE_USERNAME` and `KAGGLE_KEY` in your shell; `.env.example` documents the names.
The application does not automatically read `.env` or credentials from repository files.
Do not paste credentials into source files or commit them.

```bash
npm run data:setup
```

This downloads only `HI-Small_Trans.csv`, `HI-Small_accounts.csv`, and
`HI-Small_Patterns.txt` from the official Kaggle dataset into `data/raw/amlworld/`.
Downloads are staged and validated before replacing existing source files. Failures exit
nonzero without publishing staged downloads. There is no mirror or fixture fallback.
Allow space for source files, their download archives, and staged replacements.

The setup validates every transaction, account row, and pattern block, and checks that
pattern transactions exist in the source CSV with exactly matching field values. It then
writes `docs/data/hi-small-manifest.json` with SHA-256 checksums, sizes, row counts,
source/license, time range, label counts, and discovered/enabled typologies. This generated
metadata is intended to be reviewed and committed after successful real-data validation;
raw and derived data are gitignored. No real-data manifest is fabricated before download.
Checksums identify the files actually validated, not an independently verified publisher digest.

### Manual ZIP setup (no API credentials)

Place the downloaded Kaggle ZIP at `data/raw/amlworld/archive.zip`, then run from the
repository root:

```bash
unzip -n data/raw/amlworld/archive.zip HI-Small_Trans.csv HI-Small_accounts.csv HI-Small_Patterns.txt -d data/raw/amlworld
npm run data:profile
```

This extracts only HI-Small and keeps the ZIP. `-n` preserves any already extracted files.
This route needs Python and `unzip`, but does not need the Kaggle CLI or credentials.
The same validator and manifest are used for both download routes.

The supplied archive has been validated: 5,078,345 transactions (5,177 labelled laundering),
518,581 account rows, and 370 pattern attempts. All 3,209 pattern transaction rows match
the source CSV. Seven supported typologies are enabled; `RANDOM` is recorded separately.
See [the generated manifest](docs/data/hi-small-manifest.json) for checksums and counts.

To run stages separately or use a different local directory:

```bash
npm run data:download
npm run data:profile
npm run data:profile -- --data-dir /path/to/hi-small --manifest /tmp/manifest.json
```

Duplicate `Account` columns are validated positionally. IDs and original amount strings
are preserved when matching pattern rows; amounts are validated as decimals. Timestamps
are profiled without inventing a timezone. The account schema does not provide account
age. `RANDOM` and unknown typologies are counted but never enabled as named detectors.
Malformed or changed schemas stop processing for review. The manifest contains ground
truth metadata for preparation/evaluation, not runtime prediction features.

## Run and verify

```bash
npm run data:replay
npm run dev
```

Open the Vite URL printed in the terminal (normally http://127.0.0.1:5173). Press **Start
replay**, select 1, 5, or 20 events per second, and click a feed entry or graph arrow to
inspect its original fields. Pause freezes the stream. Reset clears emitted events and
returns speed to 1; replaying produces the same event sequence. Event-time gaps are
compressed for demonstration, while original timestamps remain visible.

The feed shows the latest 50 events. The graph initially shows the latest 40 transfers;
toggle **All observed events** to see the full emitted network. Bank/account pairs are
distinct node identities, and every transfer has its own edge. The service is shared
between browser tabs; reconnecting restores the current prefix. Stop both services with Ctrl+C.

The builder checks the validated source checksums, chooses the earliest complete attempt
of each enabled typology (at most 100 source rows per attempt), and includes 120 benign
rows within one hour of selected pattern events. Context selection uses the lowest
SHA-256 ranks of `talon-replay-v1:<source-row>`, so it is reproducible without random state.
Rows are ordered by event time, then 1-based CSV data-row number (header excluded).
The current data produces 220 events: 100 pattern transactions plus 120 context rows.
The artifact is bounded to 1,000 events and is a curated demo, **not a training/test split
or representative evaluation sample**.

`data/replay/replay.json` contains runtime transaction fields, with source IDs and decimal
amount strings preserved. `data/replay/provenance.json` separately records original rows,
ground-truth labels, selected attempts, policy, and source hashes. It is never served by
the API or consumed for runtime replay. Rebuilding both artifacts is byte-for-byte deterministic.
No source labels, typology labels, or risk claims appear in the replay UI.

Express listens on http://127.0.0.1:3001; Vite proxies `/v1` locally:

| Endpoint | Behavior |
| --- | --- |
| `GET /v1/health` | Service health, milestone, and replay availability |
| `GET /v1/events` | Current state and only the already emitted events |
| `GET /v1/events/stream` | SSE `snapshot` frames on connection and state changes; heartbeat every 15 seconds |
| `POST /v1/replay/control` | JSON `{"action":"start"}`, `pause`, `reset`, or `{"action":"speed","speed":5}` |

Invalid controls return 400; starting a completed replay returns 409 until reset. Missing
or malformed replay data produces an explicit unavailable state and 503 on controls.
Run `npm run data:replay`, then restart the API to load newly generated data.
`TALON_REPLAY_FILE` can select an alternate artifact for diagnostics. Restarting the API
always begins paused with an empty stream. There is no database or background Python worker
yet: Python prepares the subset offline and Express owns the in-memory replay.

```bash
npm test
npm run check
npm run build
```

Browser acceptance tests use the real generated replay against a running app:

```bash
npx playwright install chromium
npm run test:ui
# Or use a locally installed Chromium:
CHROMIUM_PATH=/usr/bin/chromium npm run test:ui
```

Set `TALON_UI_URL` if Vite uses a different port. Screenshots go to gitignored
`data/test-results/`. The browser test resets the shared local replay and checks controls,
pause/reload, full completion, identical reset playback, graph rendering, and mobile layout.

Tests create temporary, explicitly artificial records to verify validation and downloader
failure handling. They are not demonstration data or benchmark results. The real milestone
acceptance gate additionally requires either download route to succeed, followed by a
reproducible `npm run data:profile` result. The local manual-ZIP route has passed; the
authenticated automated download has not yet been exercised against Kaggle.

## Components and provenance

- `frontend/`: React + TypeScript + Vite with Cytoscape.js and simple CSS.
- `backend/`: Express replay service, runtime validation, REST/SSE, and tests.
- `pipeline/`: Python download, profiling, deterministic replay preparation, and tests.
- [Architecture and full plan](docs/plans/talon-12-hour-hackathon-plan.md).

Data is the **IBM AMLWorld HI-Small synthetic AML benchmark**, not real bank records.
[IBM's source repository](https://github.com/IBM/AML-Data) points to the
[official Kaggle distribution](https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml)
and identifies the data license as [CDLA-Sharing-1.0](https://spdx.org/licenses/CDLA-Sharing-1.0.html).
Downloads use the [Kaggle CLI](https://github.com/Kaggle/kaggle-api).
No synthetic device enrichment, learned models, or detection results are present yet.
