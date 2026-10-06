# IBM Multi-GNN GIN

`gin.py` contains the unchanged `GINe` class and its required imports from
[IBM/Multi-GNN](https://github.com/IBM/Multi-GNN), commit
`252b0252afca109d1d216c411c59ff70753b25fc`, `models.py`.
The unused model classes and imports are omitted. Apache-2.0 license is included.
Talon uses this GIN backbone with edge updates, a CPU temporal-snapshot adapter,
and bounded two-hop graphs. It does not reproduce IBM's full experiment pipeline
or claim IBM's reported benchmark results.
