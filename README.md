# Talon — Financial Fraud Intelligence

Talon helps investigate possible money laundering by turning financial transactions into a network of accounts and transfers. It replays transactions, detects suspicious patterns, groups related findings into cases, and shows the evidence behind each case.

The dashboard lets you inspect transaction flows, view model risk scores, and compare how holding one or more accounts would interrupt observed transfer routes. Holds are simulated; no real accounts or payments are changed.

## Technologies and models

| Part | Technologies |
| --- | --- |
| Dashboard | React, TypeScript, Vite, Tailwind CSS, Cytoscape.js, react-force-graph-3d, Chart.js |
| API and live updates | Node.js, Express, Zod, Server-Sent Events (SSE) |
| Data processing | Python, NumPy, SciPy |
| Behaviour anomaly detection | scikit-learn Isolation Forest |
| Transaction graph model | IBM Multi-GNN GINe, PyTorch, PyTorch Geometric |
| Combined risk scoring | XGBoost, with logistic calibration and TreeSHAP explanations |
| Tests | Python unittest, Node.js test runner, Playwright |

Structural rules detect fan-in, fan-out, gather-scatter, scatter-gather, cycles, stacks, and bipartite patterns. The models combine behaviour, graph, and structural signals to help prioritise review. Talon runs locally and does not require a database or GPU.

## 1. Install dependencies

Requirements: **Node.js 22.12+**, npm, and **Python 3.12+**. The commands below use a Linux/WSL Bash shell. Run them from the repository root.

```bash
npm ci
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r pipeline/requirements.txt
python -m pip install -r backend/requirements-torch.txt
python -m pip install -r backend/requirements.txt
```

Keep the virtual environment active when running the commands below. In a new terminal, run `source .venv/bin/activate` again. PyTorch is installed separately using the pinned CPU requirements.

## 2. Download and configure the data

This walkthrough uses the **IBM AMLWorld HI-Small synthetic dataset**. Raw data and trained models are not included in Git. Choose either download method below.

### Option A: Download manually

Download the archive from the [IBM AML dataset on Kaggle](https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml). Extract these three files directly into `data/raw/amlworld/`:

```text
data/raw/amlworld/
├── HI-Small_Trans.csv
├── HI-Small_accounts.csv
└── HI-Small_Patterns.txt
```

Then validate the files:

```bash
npm run data:profile
```

### Option B: Download using Kaggle credentials

Create legacy API credentials in your Kaggle account settings, then export them in the same terminal:

```bash
export KAGGLE_USERNAME="your-kaggle-username"
export KAGGLE_KEY="your-kaggle-api-key"
npm run data:setup
```

This downloads and validates the three HI-Small files. `.env.example` lists the credential names, but Talon **does not automatically load `.env` files**. Do not commit credentials.

Both methods generate `docs/data/hi-small-manifest.json`, which records file checksums and dataset counts. The recorded HI-Small source contains **5,078,345 transactions**, including **5,177 labelled laundering transactions**. Allow disk space for the download, extracted files, and generated model artifacts.

## 3. Prepare the models and demo

Run these commands in order after validating the data:

```bash
npm run models:prepare
npm run models:train
npm run models:replay
npm run evaluation:cases
```

| Command | What it produces |
| --- | --- |
| `models:prepare` | A bounded training/evaluation dataset in `data/models/dataset/` |
| `models:train` | Trained models in `data/models/current/` and transaction metrics in `docs/data/milestone4-evaluation.json` |
| `models:replay` | The interactive demo in `data/replay/`, including labelled synthetic device/network context |
| `evaluation:cases` | Case reconstruction metrics in `docs/data/milestone6-evaluation.json` |

Preparation scans the source data, and training can take time on CPU. These steps are needed once for an unchanged dataset and configuration. Checked-in reports do not replace locally trained model artifacts.

Use `models:replay` for this walkthrough. The older `data:replay` command generates an earlier demo whose events precede the learned scoring cutoff.

## 4. Run the system

```bash
npm run dev
```

This starts both applications:

- **Dashboard:** http://127.0.0.1:5173 (use the URL printed by Vite if the port changes).
- **API:** http://127.0.0.1:3001; check `/v1/health` for service status.

Default paths and ports work without additional configuration. If you need a different Python environment or model directory, set `TALON_PYTHON` or `TALON_MODELS_DIR` to its absolute path before starting the app.

Press **Begin** to start the replay. Use **Pause** to inspect the current state and the reset button to start again. Stop both services with `Ctrl+C`. Restart them after regenerating models, replay data, or evaluation reports.

## 5. Reproduce the demonstration and results

### Interactive demonstration

1. Complete steps 1–4 using HI-Small and the default model settings.
2. Open the dashboard and press **Begin**. The recorded demo contains **183 events**: 63 pattern transactions and 120 benign context transactions.
3. Select a transaction or graph account to inspect its details. Open a detected case to review its supporting transfers, patterns, and risk explanations.
4. Pause or finish the replay, select a case, and compare a single-account hold with a group hold using **Compare holds**. The result describes disruption to observed routes.
5. Open the evaluation view to inspect transaction detection and case reconstruction results separately.
6. Reset and replay to reproduce the same event sequence and decisions with the same artifacts.

The 183-event replay is a curated demonstration. Accuracy is measured separately on a **12,423-event, case-enriched subset**, with training on September 1–6, validation on September 7–8, and testing on September 9–10, 2022.

### Recorded evaluation results

The default training uses seed 42, eight GIN epochs, and a maximum of 2,048 training snapshots per fit. Keep the source files, pinned dependencies, and default parameters unchanged when reproducing the reports. Source checksums are recorded in the manifest and evaluation reports; model numbers may vary slightly across platforms.

| Transaction detection | Precision | Recall | False-positive rate |
| --- | --- | --- | --- |
| Risk threshold alone | 91.9% | 84.2% | 5.20% |
| Risk threshold with review gate | 95.1% | 46.5% | 1.68% |

The review gate additionally requires a supported structure and a strong behaviour or graph-model signal. Risk-ranking PR-AUC is **0.931**. The final test false-positive rate exceeded the 1% validation target.

Case reconstruction matched **34 of 191 detected cases** to **66 eligible ground-truth attempts**: **17.8% precision**, **51.5% recall**, and **0.537 mean matched Jaccard overlap**. This uses one-to-one transaction-overlap matching and includes low-severity cases.

Compare your regenerated reports with the repository's recorded [transaction report](docs/data/milestone4-evaluation.json) and [case report](docs/data/milestone6-evaluation.json). The preparation commands overwrite these reports; `git diff -- docs/data/` shows changes against the checked-in versions.

These results describe a bounded synthetic subset, not full-dataset or real-world accuracy. Device/network enrichment is synthetic context and does not enter the frozen risk model. Risk scores and case severity support investigation; they do not establish fraud.

## Verification and common issues

Run the automated checks from the repository root:

```bash
npm test
npm run check
npm run build
```

For browser tests, keep `npm run dev` running and use a second terminal with the virtual environment active:

```bash
npx playwright install chromium
npm run test:ui
```

Browser tests reset the shared replay. Set `TALON_UI_URL` if the dashboard is running on a different port.

| Issue | What to do |
| --- | --- |
| Missing or invalid replay | Run `npm run models:replay`, then restart the app. |
| Model scores unavailable | Check the Python dependencies, run `npm run models:train`, rebuild the replay, and restart. |
| Missing or stale case evaluation | Run `npm run evaluation:cases`, then restart. |
| Port 3001 already in use | Stop the other backend process. Root `npm run dev` already starts the API. |
| Kaggle download fails | Check the exported legacy credentials, or use the manual download option. |

## Project structure and references

- `frontend/` — dashboard and browser tests.
- `backend/` — API, Python intelligence worker, model training, and evaluation.
- `pipeline/` — data download, validation, and replay preparation.
- `docs/data/` — recorded manifests and evaluation reports.
- `data/` — local datasets, models, and replay artifacts (ignored by Git).

See the [acceptance guide](docs/milestone6-acceptance.md) for detailed checks and the [architecture](docs/plans/architecture.md) for design notes. The [vendored model documentation](backend/python/vendor/README.md) records IBM GINe's source revision and Apache-2.0 license. IBM AMLWorld is synthetic data distributed under CDLA-Sharing-1.0; see the dataset manifest for provenance.
