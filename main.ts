import * as fs from 'node:fs';
import * as path from 'node:path';

type Read = { at: string; players_tracked: number; rates: (number | null)[] };
type ForecastCase = {
  at: string;
  target: string;
  horizon_minutes: number;
  history: Read[];
  trophies: { id: number }[];
};
type Point = { hour: number; y: number };
type Fit = { median: number; spread: number };

const launch = Date.parse('2026-11-19T00:00:00Z');
const hourOf = (date: string) => (Date.parse(date) - launch) / 3_600_000;
const boundRate = (rate: number) => Math.max(0.01, Math.min(rate, 99.99));
const toLogOdds = (rate: number) => {
  const bounded = boundRate(rate);
  return Math.log(bounded / (100 - bounded));
};
const minLogOdds = toLogOdds(0.01);
const maxLogOdds = toLogOdds(99.99);
const normalOffsets = [-1.645, -0.674, 0, 0.674, 1.645];
export const calibration = { floor: 0.30, horizon: 0.08 };
const trendTime = (hour: number) => Math.log1p(hour);

function refreshes(history: Read[]) {
  return history.filter((read, i) => {
    const previous = history[i - 1];
    return !previous || previous.players_tracked !== read.players_tracked ||
      previous.rates.length !== read.rates.length ||
      read.rates.some((rate, j) => rate !== previous.rates[j]);
  }).map(read => ({ hour: hourOf(read.at), rates: read.rates }));
}

function linearFit(points: Point[], target: number): Fit | undefined {
  const n = points.length;
  if (n < 3) return;
  const xs = points.map(point => trendTime(point.hour));
  const xMean = xs.reduce((sum, x) => sum + x, 0) / n;
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    sxx += dx * dx;
    sxy += dx * (points[i].y - yMean);
  }
  if (sxx === 0) return;
  const slope = sxy / sxx;
  const offset = trendTime(target) - xMean;
  const error = points.reduce((sum, point, i) =>
    sum + (point.y - yMean - slope * (xs[i] - xMean)) ** 2, 0);
  return {
    median: yMean + slope * offset,
    spread: Math.sqrt(error / (n - 2) * (1 + 1 / n + offset ** 2 / sxx)),
  };
}

function saturatingFit(points: Point[], target: number, lastRate: number): Fit | undefined {
  if (points.length < 4) return;
  const ceilings = new Set([1.1, 1.3, 1.6, 2, 2.6, 3.5, 5, 8].map(m => Math.min(0.9999, boundRate(lastRate) / 100 * m)));
  ceilings.add(0.95);
  let bestError = Infinity;
  let bestMedian = 0;
  for (const halfTime of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
    for (const exponent of [0.7, 1, 1.3, 1.7]) {
      const fraction = (hour: number) => 100 / (1 + (halfTime / Math.max(0, hour)) ** exponent);
      const fractions = points.map(point => fraction(point.hour));
      const targetFraction = fraction(target);
      for (const ceiling of ceilings) {
        const error = points.reduce((sum, point, i) =>
          sum + (point.y - toLogOdds(ceiling * fractions[i])) ** 2, 0);
        if (error < bestError) {
          bestError = error;
          bestMedian = toLogOdds(ceiling * targetFraction);
        }
      }
    }
  }
  return { median: bestMedian, spread: 1.5 * Math.sqrt(bestError / points.length) };
}

export function forecast(input: ForecastCase, tuning = calibration) {
  const target = hourOf(input.target);
  const cutoff = hourOf(input.at);
  const horizon = Math.sqrt(input.horizon_minutes / 1440);
  const reads = refreshes(input.history);
  const trophies = input.trophies.map(({ id }, index) => {
    const points: Point[] = [];
    let lastRate = 0.01;
    for (const { hour, rates } of reads) {
      const rate = rates[index];
      if (rate == null || !Number.isFinite(rate)) continue;
      lastRate = rate;
      points.push({ hour, y: toLogOdds(rate) });
    }
    let median = toLogOdds(lastRate);
    let spread = 0.5 * horizon;
    if (lastRate >= 99.99) {
      median = toLogOdds(99.9);
      spread = 0.35;
    } else {
      const linear = linearFit(points.filter(p => p.hour > -1 && p.hour >= cutoff - 24), target);
      const saturating = saturatingFit(points.filter(p => p.hour >= cutoff - 48), target, lastRate);
      const fit = linear && saturating ? {
        median: (linear.median + saturating.median) / 2,
        spread: (linear.spread + saturating.spread + Math.abs(linear.median - saturating.median)) / 2,
      } : linear ?? saturating;
      if (fit) {
        median = fit.median;
        spread = Math.min(2.2, Math.hypot(Math.max(tuning.floor, fit.spread), tuning.horizon * horizon));
      }
    }
    median = Math.max(minLogOdds, Math.min(maxLogOdds, median));
    const q = normalOffsets.map(z => {
      const rate = boundRate(100 / (1 + Math.exp(-(median + z * spread))));
      return Math.round(rate * 1e4) / 1e4;
    });
    return { id, q };
  });
  return { trophies };
}

function run() {
  const source = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const destination = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(source).sort()) {
    if (path.extname(name) !== '.in') continue;
    const input: ForecastCase = JSON.parse(fs.readFileSync(path.resolve(source, name), 'utf8'));
    const outputName = path.basename(name, '.in') + '.out';
    fs.writeFileSync(path.resolve(destination, outputName), JSON.stringify(forecast(input)) + '\n');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) run();
