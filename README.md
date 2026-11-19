# GTA VI Trophy Rarity Forecaster

This make.fun entry forecasts the percentage of Exophase's tracked GTA VI
PlayStation 5 players who earn each trophy by the case's target. The final
target is 2026-11-26 at 00:00 UTC. Each forecast gives five quantiles per trophy.

Run from the repository root with Node 22 and the competition kit alongside the
repository:

```sh
kit=../gta6-trophy-rarity-forecast-01-kit/gta6-trophy-rarity-forecast-01-kit
mkdir -p out && MAKEFUN_INPUT_DIR="$kit/input" MAKEFUN_OUTPUT_DIR=out node main.ts
```

The program runs offline and writes one JSON forecast per case. It collapses
repeated snapshots, then averages a 24-hour logit trend and a 48-hour saturating
curve when both can be fit. The forecast spread reflects fit error, model
disagreement, and the forecast horizon. With neither fit available, it uses
the last observed rate and a random-walk spread.

Run `node validation/simulate.mjs` to reproduce the synthetic comparison and
calibration sweep. See [validation results](validation/RESULTS.md).
