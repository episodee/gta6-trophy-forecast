import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { calibration, forecast } from '../main.ts';

const levels = [0.05, 0.25, 0.5, 0.75, 0.95];
const normal = [-1.645, -0.674, 0, 0.674, 1.645];
const epoch = Date.parse('2026-11-19T00:00:00Z');
const hourMs = 3_600_000;
const stamp = hour => new Date(epoch + hour * hourMs).toISOString();
const cutoff = 59.5;
const target = 168;
const horizonMinutes = (target - cutoff) * 60;

function world(seed) {
  let state = seed >>> 0;
  const uniform = (lo, hi) => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return lo + (hi - lo) * state / 2 ** 32;
  };
  const gamma = uniform(0.7, 1.3);
  const groups = [
    ['platinum', 1, 0.3, 1.5, 90, 240],
    ['gold', 2, 2, 8, 75, 180],
    ['silver', 6, 5, 25, 45, 150],
    ['bronze', 10, 55, 85, 8, 40],
    ['bronze', 18, 25, 50, 25, 95],
    ['bronze', 17, 5, 20, 65, 220],
  ];
  const curves = groups.flatMap(([tier, count, low, high, early, late]) =>
    Array.from({ length: count }, () => ({
      tier, ceiling: uniform(low, high), halfTime: uniform(early, late), exponent: uniform(0.8, 1.6),
    })));
  curves.splice(1, 0, { tier: 'bronze', ceiling: 100, halfTime: 0, exponent: 1 });
  const trophies = curves.map(({ tier }, i) => ({
    id: i + 1, name: 'Synthetic trophy ' + (i + 1), description: '', tier,
    points: { platinum: 300, gold: 90, silver: 30, bronze: 15 }[tier], secret: false,
  }));
  function snapshot(hour) {
    const players = Math.round(638 * (1 + hour / 4.67) ** gamma);
    const commonNoise = uniform(-0.05, 0.05);
    const rates = curves.map(({ ceiling, halfTime, exponent }) => {
      if (halfTime === 0) return 100;
      const rate = ceiling / (1 + (halfTime / Math.max(0.25, hour)) ** exponent);
      return Math.round(rate * Math.exp(commonNoise + uniform(-0.08, 0.08)) * 100) / 100;
    });
    return { players_tracked: players, trophies_earned: Math.round(players * rates.reduce((a, b) => a + b) / 100), rates };
  }
  let current = snapshot(0);
  let refreshAt = uniform(2, 8);
  function read(hour) {
    while (refreshAt <= hour) {
      current = snapshot(refreshAt);
      refreshAt += uniform(2, 8);
    }
    return { slot: stamp(hour), at: stamp(hour), ...current };
  }
  const history = Array.from({ length: cutoff * 2 }, (_, i) => read(i / 2));
  const actual = read(target).rates;
  return { input: { id: 'f00', at: stamp(cutoff), target: stamp(target), horizon_minutes: horizonMinutes, levels, trophies, history }, actual };
}

function logit(rate) {
  const fraction = Math.min(0.9999, Math.max(0.0001, rate / 100));
  return Math.log(fraction) - Math.log1p(-fraction);
}

function house(input, withTrend) {
  const hours = date => (Date.parse(date) - epoch) / hourMs;
  const recent = input.history.filter(read => hours(read.at) >= hours(input.at) - 24);
  const randomWalk = 0.5 * Math.sqrt(input.horizon_minutes / 1440);
  return { trophies: input.trophies.map(({ id }, i) => {
    let center = logit(input.history.at(-1).rates[i] ?? 0);
    let spread = randomWalk;
    const points = recent.filter(row => row.rates[i] != null);
    if (withTrend && points.length >= 3) {
      const xs = points.map(row => Math.log1p(hours(row.at)));
      const ys = points.map(row => logit(row.rates[i]));
      const mean = numbers => numbers.reduce((a, b) => a + b) / numbers.length;
      const avgX = mean(xs);
      const avgY = mean(ys);
      const variance = mean(xs.map(x => (x - avgX) ** 2));
      if (variance > 0) {
        const slope = mean(xs.map((x, j) => (x - avgX) * (ys[j] - avgY))) / variance;
        center = avgY + slope * (Math.log1p(hours(input.target)) - avgX);
        const residual = Math.sqrt(mean(xs.map((x, j) => (ys[j] - avgY - slope * (x - avgX)) ** 2)));
        spread = Math.hypot(randomWalk, residual);
      }
    }
    const q = normal.map(z => Number((100 / (1 + Math.exp(-center - z * spread))).toFixed(4)));
    return { id, q };
  }) };
}

function score(predicted, actual) {
  let loss = 0;
  for (const { id, q } of predicted.trophies) {
    q.forEach((rate, j) => {
      const d = logit(actual[id - 1]) - logit(rate);
      loss += 2 * Math.max(levels[j] * d, (levels[j] - 1) * d);
    });
  }
  return loss / (actual.length * levels.length);
}

function compare(seedStart, count, choices) {
  const sums = choices.map(tuning => ({ ...tuning, loss: 0, wins: 0, maxMs: 0 }));
  let persistence = 0;
  let curve = 0;
  for (let seed = seedStart; seed < seedStart + count; seed++) {
    const { input, actual } = world(seed);
    const p = score(house(input, false), actual);
    const c = score(house(input, true), actual);
    persistence += p;
    curve += c;
    for (const entry of sums) {
      const start = performance.now();
      const prediction = forecast(input, entry);
      entry.maxMs = Math.max(entry.maxMs, performance.now() - start);
      const loss = score(prediction, actual);
      entry.loss += loss;
      entry.wins += Number(loss < Math.min(p, c));
    }
  }
  return {
    persistence: persistence / count, curve: curve / count,
    models: sums.map(row => ({ ...row, loss: row.loss / count })).sort((a, b) => a.loss - b.loss),
  };
}

function checkEdges() {
  const { input } = world(1);
  const trophies = [{ id: 7 }, { id: 22 }, { id: 31 }, { id: 42 }];
  const oneRead = [{ at: stamp(1), players_tracked: 638, rates: [0, 100, null, 9] }];
  for (const history of [[], oneRead, [...oneRead, { ...oneRead[0], at: stamp(2), rates: [0, 100, null, null] }]]) {
    for (const horizon_minutes of [90, 6510]) {
      const output = forecast({ ...input, history, trophies, horizon_minutes });
      assert.deepEqual(output.trophies.map(row => row.id), [7, 22, 31, 42]);
      for (const { q } of output.trophies) {
        assert.equal(q.length, 5);
        assert(q.every((x, i) => Number.isFinite(x) && x >= 0.01 && x <= 99.99 && (!i || x >= q[i - 1])));
      }
      assert.deepEqual(output.trophies.map(row => row.q[2]), history.length ? [0.01, 99.9, 0.01, 9] : [0.01, 0.01, 0.01, 0.01]);
    }
  }
}

checkEdges();
const choices = [0.30, 0.35, 0.45].flatMap(floor => [0.08, 0.10, 0.12].map(horizon => ({ floor, horizon })));
const sweep = compare(20261119, 40, choices);
console.log('Calibration (40 seeds)', JSON.stringify(sweep, null, 2));
console.log('Holdout (40 separate seeds) using shipped defaults', JSON.stringify(compare(80421, 40, [calibration]), null, 2));
