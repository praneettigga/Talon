# TALON — 12-Hour Hackathon Plan

## Product thesis

> **Talon reconstructs coordinated laundering cases from a financial network instead of judging each transaction in isolation.**

Talon watches a replayed transaction stream, measures unusual account behaviour, recognises supported laundering structures, uses a learned graph model for relational corroboration, and combines those signals into explainable entity risk and evidence-backed cases.

The demonstration must establish three things:

1. A legitimate unusual transaction is not escalated solely because it is unusual.
2. A laundering pattern becomes more convincing as related transactions arrive.
3. An investigator can understand the case and compare the route disruption caused by targeted holds.

## Locked architecture

```text
Transaction replay
        │
        ▼
Feature extraction and temporal graph snapshot
        │
  ┌─────┴───────────────────────────────────┐
  ▼                                         ▼
Behaviour engine                       Graph intelligence
Isolation Forest                 ┌──────────┴──────────┐
                                 ▼                     ▼
                         Dataset-supported rules   IBM Multi-GNN
                                                   GIN
  └───────────────────────────────┬────────────────────┘
                                  ▼
                        XGBoost risk fusion
                                  │
                                  ▼
                 Transaction and entity risk
                                  │
                                  ▼
                    Deterministic case correlation
                                  │
                                  ▼
                  Case severity, evidence, timeline,
                         and intervention what-if
```

React, TypeScript, Tailwind, and Cytoscape.js provide the investigator UI. An Express TypeScript service owns replay state and the REST/SSE interface. Python owns data preparation, graph construction, model inference, rule detection, and evaluation. The TypeScript service invokes a persistent Python worker through newline-delimited JSON.

Use local files and process memory only. No database, Kafka, Redis, Neo4j, authentication, cloud deployment, LLM, MCP server, RAG, next-hop prediction, custom GNN architecture, or autonomous intervention is in scope.

## Dataset and pattern boundary

**IBM AMLWorld HI-Small is the single primary benchmark and demonstration dataset.** It provides account-to-account transaction flows, timestamps, amounts, payment formats, laundering labels, account metadata, and a patterns file that groups laundering attempts by typology.

Use these source files after checking their exact downloaded names and columns:

- `HI-Small_Trans.csv` for transaction replay and transaction labels.
- `HI-Small_accounts.csv` for account attributes and account-age features where available.
- `HI-Small_Patterns.txt` for campaign ground truth, typology names, and reconstruction evaluation.

AMLWorld is a public synthetic financial-data benchmark. The README and UI must call it “IBM AMLWorld HI-Small synthetic AML benchmark”; Talon must not claim it is private or real bank data. It is still the right primary dataset because its linked transaction and pattern ground truth directly support account networks, laundering attempts, and case reconstruction.

### Hard rule: dataset-supported typologies only

Talon will build named graph-rule detectors **only for typologies present in the downloaded HI-Small patterns file and verified during ingestion**. The allowed initial detector set is:

| Dataset typology | Talon detector and UI label |
|---|---|
| Fan-In | Fan-in / collection |
| Fan-Out | Rapid dispersal |
| Gather-Scatter | Collection and dispersal |
| Scatter-Gather | Structuring and consolidation |
| Cycle | Circular flow |
| Bipartite | Coordinated bipartite movement |
| Stack | Layered transfer chain |

The importer writes the discovered typology names to a dataset manifest. A detector is enabled only when its source typology appears in that manifest. “Random” patterns are kept for model training/evaluation labels but do not receive a named rule detector or an invented visual explanation.

Do not add “smurfing,” payroll, merchant, cash-out, device, or any other pattern detector unless it maps to a supported AMLWorld typology and can be validated against its pattern cases. This prevents Talon from presenting invented fraud models as benchmark-backed detection.

Use a bounded reproducible subset for GIN training and the live replay: all transactions in selected pattern cases plus a fixed temporal benign-context sample around them. Preserve the original source rows and identifiers. Training on the complete HI-Small graph is not a 12-hour requirement.

### Synthetic enrichment

Create `talon_device_context.csv` solely for the selected replay accounts. It can add `device_id`, `ip_cluster`, `location`, and `first_seen`. It must include legitimate shared devices/networks as controls and selected suspicious shared infrastructure as corroboration.

Every UI surface and README section using it must label it **Synthetic Talon enrichment; not supplied by IBM AMLWorld**. Device/IP evidence may add context but cannot independently create a high-risk alert.

## Intelligence pipeline

### Feature extraction

Process transactions in event-time order. At each event, calculate features using only prior events in the active one-hour window and retained account history:

- Incoming/outgoing counts, totals, and unique counterparties.
- Amount mean, deviation, and recent amount distribution.
- Five-minute and one-hour velocity.
- Fan-in and fan-out degree.
- Forwarding ratio: outgoing value divided by prior-window incoming value.
- Incoming/outgoing ratio.
- New-counterparty rate.
- Account age, when provided by the dataset.
- Rule scores, GIN score, and enrichment evidence.

Persist the timestamp and feature snapshot used for each decision. Later events, pattern labels, and future rows must never affect an earlier replay score.

### Behaviour engine

Train Isolation Forest on benign training-window account snapshots only. Its inputs are the behavioural and flow features above, excluding source labels, rule outputs, GIN outputs, case IDs, and pattern metadata.

Convert its anomaly output to a 0–1 **behaviour anomaly score**. Describe it as “unusual compared with historical account behaviour,” never as a fraud probability. Accounts with too little history display “insufficient behavioural history” and receive no amount-deviation penalty.

### Dataset-supported graph rules

Each enabled typology detector produces a 0–1 strength, its involved accounts/transactions, the matching time window, and plain-language facts. Rules identify structure; they do not decide fraud by themselves.

Examples of evidence wording:

- “M1 received from 7 distinct accounts in 11 minutes.”
- “M1 forwarded 93% of its recent inflow to X.”
- “M1 and M2 consolidated to X within the same 15-minute window.”
- “A→B→C→D→A formed a time-ordered cycle.”

A rule finding can reach review-level risk only when corroborated by at least one of: high behavioural anomaly, high GIN score, or shared-infrastructure evidence. Fan-in or fan-out alone must remain low severity so routine payroll and merchant-like activity do not become false positives.

### IBM Multi-GNN: GIN

Use IBM Research’s open-source Multi-GNN implementation as the graph-learning component. Run **GIN** as the locked model; PNA is out of the hackathon scope unless it has already been verified before the event and replaces GIN without changing the interface.

Prepare the adapter before the hackathon:

1. Convert the bounded AMLWorld subset to the Multi-GNN graph input format.
2. Build temporal snapshots using only edges at or before each snapshot time.
3. Train GIN to predict labelled laundering transactions on training snapshots.
4. Export a versioned model artifact, preprocessing configuration, snapshot split, and metrics report.
5. At runtime, load the artifact and score each replay snapshot.

Use an early temporal split: 60% of replay time for training, 20% validation, and the final 20% test. Unknown or future labels cannot enter features. GIN output is a learned relational-risk score. It never acts alone, and its explanation is always paired with the concrete rule and behavioural evidence around the scored entity.

If the pre-event IBM Multi-GNN adapter cannot train or run reproducibly on the chosen subset, retain the same GIN-score interface with a documented graph-feature baseline for the demo and clearly report the limitation. Do not substitute a claimed GIN result.

### XGBoost risk fusion

Train XGBoost on temporally valid out-of-fold upstream outputs: Isolation Forest score, enabled rule scores, GIN score, flow features, account age, and synthetic-enrichment score. Do not train the fusion model on predictions produced from the same rows used to fit an upstream component.

The output is a calibrated 0–100 **entity risk score**. Calibrate on the validation window and freeze the action thresholds before final testing. Use transaction risk for the new event and derive account risk from its recent scored transactions with a time-decayed maximum.

Show feature contributions for each XGBoost decision, plus the underlying factual rule evidence. Never label a score as a certain probability unless calibration validation supports that wording.

### Case correlation and severity

Create a case when supported rule findings or high-risk entities share an intermediary, destination, synthetic infrastructure link, transaction chain, or overlapping 15-minute window. Merge only findings connected through one of those explicit links. Sources that merely paid an intermediary remain possible victims or counterparties; they are not automatically suspects.

A case includes a stable ID, entities with roles, linked transactions, enabled typologies, evidence, first/last seen times, and a stage timeline:

```text
Collection → consolidation → dispersal
```

Set case severity from the number of corroborated signals, affected entities, enabled typologies, and highest entity risk. Display `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL` with the exact inputs that established it. Case severity is a prioritisation band, not a fraud-probability claim.

A lightweight Talon Signature is optional after the core works: a vector of rule strengths, behaviour anomaly, and GIN score, compared across closed cases with cosine similarity. It must be labelled a similarity heuristic.

## Investigator experience and interfaces

Build a single-screen investigation UI with:

- Event replay controls and a live event feed.
- A case queue ordered by severity.
- A focused directed graph for the selected case, with account, transaction, and synthetic-device nodes visually distinguished.
- Entity panel showing risk, XGBoost contributions, behavioural score, GIN score, evidence facts, and role.
- Case timeline showing score changes as the campaign develops.
- Pattern labels taken directly from the enabled dataset typologies.
- Intervention comparison panel.

Minimum REST/SSE interface:

- `POST /v1/replay/control` — start, pause, reset, and speed.
- `GET /v1/events` — current replay events.
- `GET /v1/entities/:id/risk` — latest entity score and evidence.
- `GET /v1/cases` and `GET /v1/cases/:id` — case summaries and full investigation view.
- `POST /v1/interventions/simulate` — selected hold set and case ID.
- `GET /v1/evaluation` — frozen temporal-split metrics and dataset provenance.

### Intervention what-if

The simulator clones the selected case graph and removes outgoing edges from the requested held accounts. It compares one hold, such as M1, with a group hold, such as M1 + M2.

Report only observed-graph facts:

- Interrupted transfer links.
- Downstream accounts no longer reachable from the selected case sources.
- Remaining observed alternate routes.
- Accounts and counterparties touched by the hold.

Use the label: **Observed-route disruption; assumes similar routes recur.** Do not claim prevented monetary loss, predict rerouting, or execute an actual hold.

## Evaluation, acceptance, and demo

Report separate metrics for transaction detection and case reconstruction. On the final temporal test window, report precision, recall, PR-AUC, false-positive rate, confusion counts, and precision at the review threshold. Select the threshold on validation data only, targeting a 1% false-positive rate when feasible.

For case reconstruction, match a detected case to a ground-truth pattern attempt when their transaction sets overlap. Report case precision, case recall, and Jaccard overlap for matched cases, grouped by supported typology. Keep unsupported/Random cases in the total model evaluation but exclude them from named-rule recall.

Acceptance scenarios:

- A benign high-value transaction is behaviourally unusual but stays below case escalation without graph corroboration.
- A fan-in/fan-out control resembling merchant collection or payroll stays below review severity without corroboration.
- A supported pattern develops through the replay and forms one case as evidence arrives.
- Rules only appear for typologies listed in the dataset manifest.
- Every entity score and case severity exposes its evidence and timestamped inputs.
- Source accounts are not automatically marked as suspicious.
- Reset produces the same stream, scores, cases, and what-if result.
- Simulation does not mutate the observed graph.
- A Python-worker/model failure returns an explicit unavailable state rather than a fabricated score.

The live demo runs in this order: normal activity; legitimate anomaly; early pattern signal; collection/consolidation; GIN corroboration; fused entity risk; one correlated case; evidence/timeline; single versus group hold comparison.

## Delivery sequence

| Time | Deliverable |
|---|---|
| Before hackathon | Download and profile HI-Small; verify typology manifest; prepare bounded subset and Multi-GNN GIN adapter/artifact |
| 0–2 h | React/Express/Python scaffold; deterministic IBM transaction replay reaches the UI |
| 2–4 h | Features, Isolation Forest, enabled rule engine, evidence records, and case correlation |
| 4–5.5 h | Load GIN artifact, run inference, train/load XGBoost fusion, and export evaluation |
| 5.5–8 h | Case graph, entity evidence, timeline, and case queue |
| 8–9 h | Intervention comparison and synthetic-enrichment controls |
| 9–10.5 h | Temporal leakage checks, benign controls, case-reconstruction metrics |
| 10.5–12 h | README, provenance, clean-start rehearsal, and backup recording |

If time is constrained, protect the replay, the supported graph rules, explainable case builder, and benign controls. Talon Signature, animation polish, and additional typologies are the first cuts.
