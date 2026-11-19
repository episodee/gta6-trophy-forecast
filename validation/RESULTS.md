# Validation results

The final-like simulation uses 55 trophy curves, including one trophy pinned at
100%. Player growth and trophy progression vary by seed. Noisy snapshots refresh
every 2 to 8 hours and are read every 30 minutes until the checkpoint. The
answer is the latest snapshot visible at the target, 6,510 minutes later.

| Sample | Ensemble | House persistence | House curve | Beat both |
| --- | ---: | ---: | ---: | ---: |
| Calibration | 0.189292 | 0.381177 | 0.277686 | 40/40 |
| Holdout | 0.202503 | 0.373971 | 0.290054 | 40/40 |

Scores are mean logit pinball losses. The house curve simulation uses all reads
in the last 24 hours and combines residual RMSE with random-walk spread in
quadrature. The lowest calibration loss across the nine combinations used a
0.30 spread floor and a 0.08 horizon coefficient. The holdout uses separate
seeds and the selected settings. The house AI forecast was unavailable for comparison.

On Node 22.23.5, the two practice cases took 0.60 seconds together on the first
run and 0.49 seconds on the repeat. Both produced valid 55-row output files of
2,644 bytes. All four copies had SHA-256
`a11ba28f10163f8408a87a056b5c5ab0cd430f634922d0aaae7a4749b15a0a1e`.
The flat histories reduce to one snapshot, so the model uses persistence except
for the 100% trophy. A loss near the house's published practice loss of 1.51 is
expected because the histories give no evidence for the size of the first refresh.
The kit does not include the practice answers for local scoring.
