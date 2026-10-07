# Talon — Financial Fraud Intelligence

Talon is being built to reconstruct explainable laundering cases from transaction networks.
Milestones 1–6 provide validated data preparation, deterministic replay, event-time
features, supported structural rules, evidence-backed cases, learned risk scoring,
observed-route intervention comparisons with labelled synthetic context, and separate
temporal transaction-detection and case-reconstruction evaluations.

## Requirements and setup

- Node.js 22.12+ and npm (verified locally with Node 26).
- Python 3.12+ for the pinned model/evaluation dependencies, available as `python`.
  Data preparation and structural rules also support Python 3.11. The worker and model commands prefer `.venv/bin/python`
  when present; `TALON_PYTHON` overrides it. Model dependencies are pinned in `backend/`.
  Data preparation and structural rules can still run with only the standard library.
- Kaggle legacy API credentials for automated download, or a manually downloaded Kaggle ZIP.

```bash
npm ci
python -m venv .venv
.venv/bin/python -m pip install -r pipeline/requirements.txt
.venv/bin/python -m pip install -r backend/requirements-torch.txt
.venv/bin/python -m pip install -r backend/requirements.txt
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

The supplied archive is `docs/data/raw/amlworld/archive.zip`. From the repository root, extract only
the HI-Small source files into the backend's raw data directory, then validate them:

```bash
mkdir -p data/raw/amlworld
unzip -n docs/data/raw/amlworld/archive.zip HI-Small_Trans.csv HI-Small_accounts.csv HI-Small_Patterns.txt -d data/raw/amlworld
npm run data:profile
```

This extracts only HI-Small and keeps the ZIP. `-n` preserves any already extracted files.
This route needs Python and `unzip`, but does not need the Kaggle CLI or credentials.
The same validator and manifest are used for both download routes.

This extracts only HI-Small and leaves the source ZIP under `docs/data/raw/amlworld/`. `-n` preserves any
already extracted files. The frontend data room reads the backend's observed replay prefix
and presents cases, accounts, transfers, and findings derived from those observations; it
does not load the 5-million-row source CSV into the browser. After validation, follow
`Run and verify` below to prepare scoring artifacts and generate the replay snapshot.

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
npm run models:prepare
npm run models:train
npm run models:replay
npm run evaluation:cases
npm run dev
```

Run model preparation/training once after setting up Python dependencies. They use the
validated local HI-Small files, need no Kaggle credentials or GPU, and leave learned artifacts
in gitignored `data/models/current/`. The checked-in evaluation report is not a substitute
for those artifacts. Restart the API after regenerating artifacts or replay data.
`npm run data:replay` still restores the original early milestone-2/3 demo, whose events
precede the model cutoff and deliberately have no learned scores.

`npm run dev` from the repository root is an optional full-stack shortcut: it starts both
the API and the UI. Each application can also be run from its own directory:

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

Open the Vite URL printed by the frontend (normally http://127.0.0.1:5173). Press **Play**,
select 1, 5, or 20 events per second, and click a feed entry or graph transfer to
inspect its original fields. Pause freezes the stream. Reset clears emitted events and
returns speed to 1; replaying produces the same event sequence. Event-time gaps are
compressed for demonstration, while original timestamps remain visible.

The feed shows the latest 50 events. The graph initially shows the latest 40 transfers;
toggle **All observed events** to see the full emitted network. Bank/account pairs are
distinct node identities, and every transfer has its own edge. The service is shared
between browser tabs; reconnecting restores the current prefix. Stop both services with Ctrl+C.

The original `data:replay` builder checks source checksums and chooses the earliest complete attempt
of each enabled typology (at most 100 source rows per attempt), and includes 120 benign
rows within one hour of selected pattern events. Context selection uses the lowest
SHA-256 ranks of `talon-replay-v1:<source-row>`, so it is reproducible without random state.
Rows are ordered by event time, then 1-based CSV data-row number (header excluded).
That early demo produces 220 events: 100 pattern transactions plus 120 context rows.
The artifact is bounded to 1,000 events and is a curated demo, **not a training/test split
or representative evaluation sample**.

`models:replay` uses the **latest** complete attempt of each enabled typology, with the same
100-row attempt bound and deterministic 120-row benign-context policy. The current later
demo has **183 events** (63 pattern transactions and 120 benign context rows), all at or after
the frozen scoring cutoff. Its full source attempts remain in preparation-only provenance;
findings are reconstructed from observed transactions, never source pattern IDs. Some later
examples do not match the deliberately narrow rule definitions. This demo is separate from
the temporal evaluation population, and later dates beyond the evaluated window are unvalidated.

`data/replay/replay.json` contains runtime transaction fields, with source IDs and decimal
amount strings preserved. `data/replay/provenance.json` separately records original rows,
ground-truth labels, selected attempts, policy, and source hashes. It is never served by
the API or consumed for runtime replay. Rebuilding both artifacts is byte-for-byte deterministic.
Per-row source labels and pattern-case ground truth do not enter inference or the UI.
Aggregated frozen evaluation metrics are displayed separately.
Named findings are generated from observed graph structure and the manifest's verified
typology vocabulary.

Express listens on http://127.0.0.1:3001; Vite proxies `/v1` locally:

| Endpoint | Behavior |
| --- | --- |
| `GET /v1/health` | Service health, milestone, and replay availability |
| `GET /v1/events` | Current state and only the already emitted events |
| `GET /v1/events/stream` | SSE `snapshot` frames on connection and state changes; heartbeat every 15 seconds |
| `POST /v1/replay/control` | JSON `{"action":"start"}`, `pause`, `reset`, or `{"action":"speed","speed":5}` |
| `GET /v1/cases` | Correlated structural cases and verified enabled typologies |
| `GET /v1/cases/:id` | Case evidence, observed transactions, roles, severity inputs, and timeline; merged IDs resolve to the surviving case |
| `GET /v1/entities/:id/risk` | Entity risk, latest transaction score, behaviour/GIN outputs, XGBoost contributions, prior-event features and evidence |
| `GET /v1/events/:id/features` | Immutable feature and model decision snapshot for an already observed event |
| `GET /v1/evaluation` | Frozen split, source provenance, model settings, calibration, thresholds and transaction metrics; 503 when models are unavailable |
| `GET /v1/evaluation/cases` | Separate frozen structural case-reconstruction metrics, matching details and provenance; 503 when missing or stale |
| `POST /v1/interventions/simulate` | Compare account holds against one frozen observed case graph; executes no hold |

Invalid controls return 400; starting a completed replay returns 409 until reset. Missing
or malformed replay data produces an explicit unavailable state and 503 on controls.
Run `npm run data:replay`, then restart the API to load newly generated data.
`TALON_REPLAY_FILE` can select an alternate artifact for diagnostics. Restarting the API
always begins paused with an empty stream. Express owns replay state and invokes a persistent
Python worker in `backend/python/` through NDJSON for each new event. Replay commits an
event after its intelligence response; requests are processed one at a time. Pause waits
for any in-flight event. Reset resets both processes and discards stale responses. No database
is used. A missing worker, manifest/hash mismatch, process exit, or timeout produces an
explicit unavailable intelligence state; runtime worker failures pause the replay without
committing an unprocessed event. Restart the API to recover a failed worker.
Missing dependencies/artifacts or artifact checksum mismatch leave structural intelligence
available with `models.status: unavailable` and null scores. A model inference failure pauses
replay and exposes unavailable intelligence. No fallback heuristic is presented as learned risk.
`TALON_MODELS_DIR` can select another locally trained artifact directory.

## Milestone 3 investigation

Start replay and select a case in the new **Case queue** below the transaction feed.
Its graph shows supporting transfers only. Click a node or use **Inspect account** to
see observed roles and prior-event features; click supporting transaction IDs to inspect
their source fields. Violet nodes have named structural roles; teal nodes are counterparties.
Colours do not indicate suspicion. Evidence gives source transaction IDs, matched windows,
structure strength, and observation times. The timeline records each finding's arrival/growth.

Features use only earlier emitted events: five-minute/one-hour velocity, incoming/outgoing
counts and Decimal totals, fan degrees, forwarding/incoming-outgoing ratios, retained-history
amount mean/deviation, and new-counterparty rate. Currency totals are never combined or
converted. Amount z-scores are omitted with fewer than five comparable observations or zero
variance. These descriptive features are not an anomaly model. Account age is unavailable.

Structural rules use a **seven-day observed window**, because the selected IBM examples
span multiple days. This is separate from the one-hour feature window; it does not claim
rapid movement where timing does not support it. Every finding displays its actual time range.
Only typologies verified in the manifest are enabled; `RANDOM` has no named detector.

| Typology | Minimum structural match |
| --- | --- |
| FAN-IN / FAN-OUT | Two distinct incoming sources / outgoing destinations |
| GATHER-SCATTER | Two distinct sources and destinations with collection before dispersal |
| SCATTER-GATHER | A source reaches a common destination through two distinct intermediaries in event order |
| CYCLE | A time-ordered simple circular path of 2–12 transfers |
| STACK | Three time-ordered links through four distinct accounts |
| BIPARTITE | Two sources both reach the same two distinct destinations (complete 2×2 substructure) |

Self-transfers are excluded from named structural rules. Temporal path search is bounded
to 10,000 expansions per event. These are heuristic structural detectors, not complete
implementations of every AMLWorld pattern variation. Strength is a 0–1 structural heuristic:
fan rules use degree/5, scatter-gather uses intermediary count/4, both capped at 1; gather-scatter,
cycle, stack, and bipartite use fixed strengths 0.7, 0.8, 0.6, and 0.6. Strength is not a fraud
probability or calibrated entity risk.

Cases merge through shared supporting transactions or shared structural anchors within
seven days. Mere temporal proximity or unrelated payer accounts do not merge cases. Stable
case IDs survive growth; merged IDs are retained as aliases. Sources remain counterparties
unless a supported structural role is observed, and every entity remains unassessed for suspicion.
Each merge records the explicit transaction/anchor links; **Why these findings belong together**
exposes them. Older evidence windows remain recorded when a new window starts.
Without models, cases remain **LOW** with zero corroborated signals and null entity risk.
With milestone 4 artifacts, severity can rise only with both model corroboration and risk
above the frozen review threshold. Scores never automatically mark sources or other accounts
as suspects. The severity view exposes the exact inputs and observation time.

The original 220-event sample yields five correlated cases and 18 structural findings. This
is a reproducible demo result, not precision/recall evaluation. Some selected typologies do
not match the deliberately narrow v1 rules. Milestone 6 evaluates reconstruction separately
on the frozen modeling test window; broader rule coverage remains future work.

## Milestone 4 learned scoring

All model code, dependencies, and the licensed IBM adapter live under `backend/`. The
pipeline prepares **12,423** real source transactions from the first **10 days**: all 4,522
labelled positives (including RANDOM and ungrouped positives), up to 6,000 deterministic
benign rows touching pattern/control accounts, and 2,000 global benign rows. Overlap is
deduplicated. Controls are the 32 most frequent accounts in the first 20,000 rows after
retaining benign seed rows. Selection is case-enriched, not representative of deployment
prevalence; no metrics claim to describe the complete HI-Small benchmark.

The first exploratory 14-day run had only two benign examples in its test tail. It was
rejected as inadequate for false-positive evaluation. The fixed 10-day envelope keeps
substantial benign support in every split; model hyperparameters were not tuned on final
test performance. This is an initial development evaluation, not an independent benchmark.

The split uses elapsed event time, keeping equal timestamps together:

| Window | Dates (end exclusive) | Rows / positives |
| --- | --- | --- |
| Train, 60% | September 1 → September 7 | 7,404 / 2,530 |
| Validation, 20% | September 7 → September 9 | 2,698 / 1,036 |
| Test, 20% | September 9 → September 11 | 2,321 / 956 |

1. **Isolation Forest:** 64 trees, benign-labelled training-transaction account snapshots
   only. Inputs exclude labels, IDs, named-rule scores, GIN outputs and case metadata.
   Fit separate currency baselines with at least 32 snapshots and five prior observations.
   Final baselines are available for US Dollar (2,233 snapshots) and Euro (49). Anomaly is
   the empirical percentile of the forest's anomaly output against its benign fit distribution,
   expressed as 0–1 unusualness, not fraud probability. Sparse histories/untrained currencies
   return null; amount z-score is also absent with fewer than five observations or zero variance.
2. **IBM Multi-GNN GIN:** pinned upstream `GINe` class, Apache-2.0, two layers, hidden width
   16, edge updates, eight epochs, fixed seed 42, CPU. Each decision uses its own observed
   two-hop/seven-day prefix graph, capped at the newest 128 edges. Node features are constant;
   edge features use relative age, normalized log amount received and one-hot currency/payment
   format. Training-only normalization/vocabulary includes unknown categories. Fit is bounded
   to 2,048 hash-selected snapshots per prefix. This runs the actual IBM model class, with a
   Talon temporal adapter; it does not reproduce IBM's full experiments. Source and license:
   [vendored model provenance](backend/python/vendor/README.md). A compatible formatted
   transaction CSV is exported under `data/models/dataset/`, for offline interoperability only.
3. **XGBoost fusion:** 64 depth-three trees. Only forward out-of-fold upstream predictions
   enter fusion fitting: fit on days 1–2, predict days 3–4; fit on days 1–4, predict days 5–6.
   No fusion training row was used to fit its upstream component. The final upstream artifacts
   are refit on the first six days; validation/test labels never enter those fits. Inputs are
   anomaly availability/score, GIN score, seven rule strengths and prior flow features.
   Account age is unavailable. Synthetic enrichment is excluded from the frozen model inputs;
   milestone 5 adds it as visible context only.
4. **Calibration and threshold:** logistic/Platt scaling on September 7–8 only. September
   8–9 selects a review threshold targeting at most 1% false positives **with the transaction
   review gate**. Freeze the threshold (**79.2383 / 100**) and all artifacts before final testing.
   Runtime scoring begins September 9; earlier events are explicit historical warmup with null
   scores, even when artifacts are loaded. No retrospective score uses future-trained weights.

The review gate requires a supported structure plus behaviour anomaly ≥0.99 or GIN ≥0.80,
and fused risk at/above the threshold. The reported transaction gate uses that event's
bounded rule strengths and endpoint model signals. Case severity instead uses explicit
structural-role accounts and the case's evidence; transaction metrics are not case metrics.

| Final test metric | Risk threshold alone | With transaction review gate |
| --- | --- | --- |
| Precision | 91.9% | 95.1% |
| Recall | 84.2% | 46.5% |
| False-positive rate | 5.20% | 1.68% |
| TP / FP / FN / TN | 805 / 71 / 151 / 1294 | 445 / 23 / 511 / 1342 |

Risk-ranking PR-AUC (average precision) is **0.931**; Brier score is **0.077**. The validation
gate met the target (0.964%), but final test FPR **exceeded 1%**. The threshold was not retuned
after testing. The checked-in [evaluation report](docs/data/milestone4-evaluation.json) records
source hashes, split boundaries, fold provenance, settings, artifact hashes and confusion counts.
The UI exposes the same frozen report. Sparse demo histories differ from the richer modeling
prefixes, so demo scores are not additional evaluation results.

Each transaction stores its decision timestamp, model version, inputs, scores and native
XGBoost TreeSHAP contributions. Signed contributions sum with the base value to the raw
XGBoost margin **before calibration**; they are not additive percentages of the displayed risk.
Entity risk is a seven-day time-decayed maximum of its scored transfers, with a 24-hour
e-folding time. Inactive accounts decay as replay time advances too. `riskAsOf` records the
aggregate time; `asOf` records the latest transaction decision. The API identifies the contributing transaction; displayed contributions
explain the latest transaction, not that aggregate. Neither entity risk nor severity is a
calibrated fraud probability. Earlier decisions are immutable, and reset recreates them.

Case severity stays LOW without corroboration and above-threshold structural-account risk;
MEDIUM meets both. HIGH additionally needs risk ≥80, at least four entities, and either two
signal types or two typologies. CRITICAL needs risk ≥95, six entities, two signal types and
two typologies. All bands also require the frozen review threshold. Expired evidence cannot
corroborate a case. Evidence growth, risk changes and severity changes appear in the timeline.

Model artifacts are local, hash-checked and source-bound. Only load your locally trained
joblib artifacts; they are not a portable untrusted interchange format. The original raw
labels, pattern attempts and replay provenance remain preparation/evaluation-only and are
never loaded by runtime inference. Model commands are also available from `backend/`:
`npm run models:prepare`, `npm run models:train`, `npm run models:replay`.

## Milestone 5 intervention comparison and synthetic context

Pause or complete replay, select a case, and use **Compare observed-route disruption**.
Choose a single account and additional accounts for the group hold, then click **Compare
holds**. An optional source selection lets you inspect reachability from a particular account.
The results compare interrupted transfer links, downstream accounts no longer reachable,
remaining alternate route witnesses, and directly touched accounts/counterparties. Preview
either scenario on the case graph: held accounts and interrupted links appear in red.
Advancing replay invalidates the preview; compare again at the new prefix.

Every comparison is labelled **“Observed-route disruption; assumes similar routes recur.”**
It removes outgoing observed transfer links from held accounts in a copy of the case graph.
It executes no hold and estimates no monetary loss prevented. Reachability is directed and
static: it does not enforce transfer-time ordering. Automatic sources are accounts with
outgoing links and no incoming links; a source-free cycle uses the earliest transfer's sender.
Starting sources are excluded from downstream counts. Parallel transfers keep their separate
IDs. One shortest route witness per reachable destination is counted, with at most 50 displayed;
these are not counts of every possible path. An alternate witness means the baseline witness
was interrupted but another route still reaches its destination. Directly touched accounts are
held accounts plus endpoints of interrupted transfers; touched counterparties are those with
an observed counterparty role (an account can also have another role).
Synthetic infrastructure links never enter the simulator's transfer graph.

Example request:

```json
{"caseId":"<observed-case-id>","heldAccountIds":["<bank/account>"],"compareHeldAccountIds":["<bank/account>","<second-bank/account>"],"expectedCursor":183}
```

Group holds must include the single hold. `sourceAccountIds` is optional. All selected accounts
must belong to the observed case. The endpoint resolves merged case aliases and freezes the
supporting transfers at request time. Invalid selections return 400, unknown cases 404, stale
cursors or reset during simulation 409, and unavailable simulation workers 503. Comparison
does not change replay, decisions, model risk, case severity, or evidence.

`models:replay` now also generates deterministic synthetic device/network/location context.
For an existing replay, regenerate only that context with:

```bash
npm run enrichment:prepare
# Restart the API to load the regenerated files.
```

The gitignored `data/replay/enrichment.csv` has columns
`account_id,device_id,ip_cluster,location,first_seen,scenario`. Its sidecar binds it to the
replay hash, validated source hash, CSV checksum, schema and account coverage. The current
183-event replay produces 290 assignments for 288 accounts. Each account initially has its
own device/network. Two early accounts share a network but distinct devices as a synthetic
legitimate-sharing control; this is not an IBM ground-truth classification. Once an observed
structural finding supports a pair of other accounts, an additional shared-device/network
assignment becomes visible from that observation time. Generation reads runtime transfers
and reconstructed findings, never source labels or pattern provenance. Future assignments
and unobserved accounts remain hidden, and each transaction's context snapshot is immutable.

The UI labels all context **“Synthetic Talon enrichment; not supplied by IBM AMLWorld”**.
Shared IP alone does not support structure. Shared devices can link to observed structural
findings as additional context, but neither changes frozen risk, severity, nor case correlation.
The milestone 4 metrics do not evaluate these synthetic signals. Missing, stale or corrupt
enrichment produces an explicit unavailable context state while structural intelligence and
models remain usable. `TALON_ENRICHMENT_FILE` selects an alternate CSV.

## Milestone 6 case reconstruction and acceptance

Run `npm run evaluation:cases` after `models:prepare`, then restart the API. The command
reconstructs cases from all 12,423 prepared source events in order, using the same live
finding-growth and correlation code. It omits model inference because this evaluation
measures **structural reconstruction, including LOW cases**, rather than review-alert
precision. Earlier events provide warmup; the test window remains **September 9–11, 2022**
(end exclusive), exactly as frozen in milestone 4. No thresholds or detectors are tuned on
the test results. Transaction precision/recall and the learned artifacts remain unchanged.

The generated [case evaluation report](docs/data/milestone6-evaluation.json) records input,
source-file, detector/evaluator-code and transaction-report checksums, exclusions, matching
pairs, unmatched cases, and missed attempts. The API checks schema, metric arithmetic,
one-to-one matching, source hashes, code hashes, the frozen split, and the local evaluation
input hash when present. Missing or stale reports are explicitly unavailable; they do not
disable replay or learned scoring. The **Case reconstruction** panel shows overall metrics,
supported-typology metrics and the matching method, separately from transaction evaluation
and the curated demonstration.

The frozen run matches **34 of 191 detected cases** to **66 eligible attempts**:
case precision **17.8%**, recall **51.5%**, and mean matched Jaccard **0.537**.
The low precision exposes extra structural cases and campaign fragmentation/merging;
these figures include LOW cases and do not replace the review-gate transaction metrics.

Detected cases and eligible ground-truth attempts are projected onto test-window transfers.
An attempt is eligible only if its typology is enabled and its entire source transaction set
was present by the evaluation end. Boundary-truncated attempts are excluded. RANDOM and
unsupported attempts are excluded from named-rule reconstruction; their transactions remain
in milestone 4's total transaction evaluation. Their transfers are excluded from reconstruction
metrics unless also part of an eligible supported attempt. Benign test transfers and ungrouped
positives remain in the reconstruction population, so unrelated detected structures can count
as unmatched cases.

Any nonempty transaction overlap permits a match. A deterministic maximum-cardinality
one-to-one assignment first maximizes the number matched, then total Jaccard overlap.
Precision is matched cases / detected cases; recall is matched attempts / eligible attempts.
Jaccard is intersection / union of the two projected transaction sets, averaged over matches.
Duplicate case fragments cannot inflate recall, and one merged case cannot recover several
attempts in the overall count. Per-typology matching runs independently using only that
typology's evidence, so those counts are not additive. Empty denominators display unavailable.
These are bounded, case-enriched synthetic-subset results, not full-benchmark or deployment
estimates; a loose overlap match is not exact campaign recovery.

Acceptance tests cover prior-only features and graphs, frozen calibration/threshold provenance,
immutable decision prefixes, repeatable reset and intervention results, and unavailable worker,
model and evaluation states. Explicit artificial controls verify that a high-value anomaly alone
creates no case, payroll-like fan-out stays LOW without corroboration, and a supported structure
grows into one evidence-backed case when corroborated. These controls test prioritisation logic;
they are not extra benchmark results. Source accounts remain unassessed for suspicion.
Offline reconstruction is compared against the full live detector at every prefix of the real
demo and on artificial merging/expiry streams.
Milestone 6 also fixes partial-window expiry creating a fresh finding on an unrelated
transfer: new evidence must include the arriving transfer. Expiry alone cannot grow a case.
See [the acceptance and local rehearsal guide](docs/milestone6-acceptance.md) for the
complete preparation, verification, demo and recovery sequence.

```bash
npm test
npm run check
npm run build
```

Browser acceptance tests use the real generated replay against a running app:

```bash
npx playwright install chromium
cd frontend && npm run test:ui
# Or use a locally installed Chromium:
CHROMIUM_PATH=/usr/bin/chromium npm run test:ui
```

Set `TALON_UI_URL` if Vite uses a different port. The browser tests reset the shared local
replay and verify live API data in the merged dashboard, replay controls, model and case
evaluation panels, and CSV import provenance. For the browser checks, prepare model
artifacts, the later replay, and case evaluation first.

CSV import is a local source-data explorer. It displays supplied account risk or the
maximum supplied transaction risk, if available. It does not submit imports to the
backend or run Talon's trained models on them; missing scores remain unavailable.

Tests create temporary, explicitly artificial records to verify validation and downloader
failure handling. They are not demonstration data or benchmark results. The real milestone
acceptance gate additionally requires either download route to succeed, followed by a
reproducible `npm run data:profile` result. The local manual-ZIP route has passed; the
authenticated automated download has not yet been exercised against Kaggle.

## Components and provenance

- `frontend/`: React + TypeScript + Vite with 3D and Cytoscape.js network views.
- `backend/`: Express replay/REST/SSE service, Python feature/rule/case worker, model training/inference and tests.
- `pipeline/`: Python download, profiling, deterministic replay preparation, and tests.
- [Architecture and full plan](docs/plans/talon-12-hour-hackathon-plan.md).

Data is the **IBM AMLWorld HI-Small synthetic AML benchmark**, not real bank records.
[IBM's source repository](https://github.com/IBM/AML-Data) points to the
[official Kaggle distribution](https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml)
and identifies the data license as [CDLA-Sharing-1.0](https://spdx.org/licenses/CDLA-Sharing-1.0.html).
Downloads use the [Kaggle CLI](https://github.com/Kaggle/kaggle-api).
Synthetic Talon device/network context is separate from the IBM benchmark and does not enter
the frozen risk model. Structural findings require model corroboration and threshold support
before review escalation. Simulations describe observed-route disruption only.
