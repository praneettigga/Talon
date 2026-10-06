                           TRANSACTION STREAM
                                  │
                                  ▼
                         FEATURE EXTRACTION
                                  │
                   ┌──────────────┴──────────────┐
                   │                             │
                   ▼                             ▼
            BEHAVIOUR ENGINE             GRAPH INTELLIGENCE
                   │                             │
          Isolation Forest              ┌────────┴────────┐
                   │                    │                 │
                   │                    ▼                 ▼
                   │             GRAPH RULES          IBM GNN GIN/PNA
                   │                    │                 │
                   │               Structuring           │
                   │               Consolidation         │
                   │               Fan-out               │
                   │               Circular Flow         │
                   │               Device Links          │
                   │                    │                 │
                   └────────────────────┼─────────────────┘
                                        │
                                        ▼
                                  RISK FUSION
                                     XGBoost
                                        │
                                        ▼
                                  ENTITY RISK
                                        │
                                        ▼
                                 CASE CORRELATION
                                        │
                                        ▼
                                CAMPAIGN / CASE RISK
                                        │
                     ┌──────────────────┼──────────────────┐
                     ▼                  ▼                  ▼
                 Evidence           Timeline          Intervention
                                                         What-if
