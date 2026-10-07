# Milestone 6 acceptance and local rehearsal

Use the validated local IBM AMLWorld HI-Small synthetic AML benchmark. The curated
183-event demo is separate from the frozen 12,423-event modeling/evaluation population.
No per-row labels or pattern-attempt ground truth enter runtime prediction.

## Preparation

From the repository root, install the dependencies documented in the README. If the
local model artifacts and derived dataset already exist, no retraining is required.
For a fresh checkout with the validated source files:

```bash
npm ci
python -m venv .venv
.venv/bin/python -m pip install -r pipeline/requirements.txt
.venv/bin/python -m pip install -r backend/requirements-torch.txt
.venv/bin/python -m pip install -r backend/requirements.txt
npm run data:profile
npm run models:prepare
npm run models:train
npm run models:replay
npm run evaluation:cases
```

`models:replay` prepares the synthetic enrichment too. If only enrichment is missing,
run `npm run enrichment:prepare`. Evaluation does not retrain or retune the models.
Its report is written atomically only after successful source validation and replay.

## Automated gates

```bash
npm test
npm run check
npm run build
```

The tests cover metric denominators, one-to-one matching, duplicates, merges, empty
populations, unsupported/boundary exclusions, cross-typology shared transfers, and
offline/live reconstruction parity. They also exercise earlier milestone controls:
prior-only features and graphs, frozen fit/calibration/threshold windows, immutable
decisions, benign anomaly and payroll-like fixtures, source roles, reset, simulation
purity, enrichment prefix visibility, corrupted artifacts, and worker failure.

Artificial acceptance fixtures test invariants, not additional benchmark accuracy.
The checked-in reports contain the actual bounded-source evaluation results. The
case report includes LOW structural cases and therefore is not review-alert accuracy.
Never use the transaction review-gate precision as the case-reconstruction precision.

## Browser rehearsal

Start the two applications in separate terminals:

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm run dev
```

Then, from `frontend/` with Chromium installed:

```bash
CHROMIUM_PATH=/usr/bin/chromium npm run test:ui
```

The browser suite resets the shared local stream. It checks pause/reconnect, case
evidence, risk contributions, both evaluation panels, synthetic labels, single/group
holds, graph previews, unchanged intelligence after simulation, repeatable reset,
mobile overflow, and the explicit unavailable case-report state. Screenshots are
saved under gitignored `frontend/test-results/`.

For a manual demo, open the frontend URL, use 20 events/sec, and start replay. Inspect
early transfers, then pause as a case forms. Read its factual evidence and timestamped
severity inputs before inspecting model contributions. Complete replay and select a
case containing the synthetic shared-device context. Compare a single hold with a
group hold and inspect both graph previews. The label must remain “Observed-route
disruption; assumes similar routes recur.” No hold is executed and no monetary loss
prevented is estimated. Reset and replay to reproduce the same decisions and results.

Finally open both evaluation panels. Transaction detection is the frozen milestone 4
test result. Case reconstruction is an independent offline report for the same test
window, with one-to-one overlap matching and Jaccard. Unsupported and incomplete
attempt exclusions, subset bias, and merge/fragmentation limitations remain visible.

## Recovery

Missing model artifacts leave structural replay available with explicit null scores.
A worker inference failure pauses replay without committing an unprocessed event;
restart the API after resolving the cause. Missing/stale case evaluation returns 503
only from `/v1/evaluation/cases`; regenerate it and restart the API. Changed model
dataset inputs, detector/evaluator code, source manifest, or frozen transaction report
require regeneration rather than reusing mismatched case metrics.
