import * as d3 from 'd3';

export function computeStepReturns(values: number[]): Array<number | null> {
  const returns: Array<number | null> = [null];

  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1];
    const current = values[i];

    if (!Number.isFinite(previous) || !Number.isFinite(current)) {
      returns.push(null);
      continue;
    }

    const denominator = Math.max(1e-6, Math.abs(previous));
    returns.push((current - previous) / denominator);
  }

  return returns;
}

export function simpleMovingAverageSeries(values: number[], window: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (window <= 0) return result;

  let rollingSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    rollingSum += values[i];
    if (i >= window) {
      rollingSum -= values[i - window];
    }

    if (i >= window - 1) {
      result[i] = rollingSum / window;
    }
  }

  return result;
}

export function rollingStdSeries(values: number[], window: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (window <= 1) return result;

  for (let i = window - 1; i < values.length; i += 1) {
    const slice = values.slice(i - window + 1, i + 1);
    if (slice.some((value) => !Number.isFinite(value))) continue;

    const mean = d3.mean(slice);
    if (mean == null) continue;

    const variance = d3.mean(slice, (value) => (value - mean) ** 2) ?? 0;
    result[i] = Math.sqrt(Math.max(0, variance));
  }

  return result;
}

export function computeRsiSeries(values: number[], length: number): Array<number | null> {
  const rsi: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= length) return rsi;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= length; i += 1) {
    const delta = values[i] - values[i - 1];
    gains += Math.max(0, delta);
    losses += Math.max(0, -delta);
  }

  let avgGain = gains / length;
  let avgLoss = losses / length;
  rsi[length] = computeRsiFromAverages(avgGain, avgLoss);

  for (let i = length + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const gain = Math.max(0, delta);
    const loss = Math.max(0, -delta);

    avgGain = ((avgGain * (length - 1)) + gain) / length;
    avgLoss = ((avgLoss * (length - 1)) + loss) / length;
    rsi[i] = computeRsiFromAverages(avgGain, avgLoss);
  }

  return rsi;
}

function computeRsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function percentileRank(values: number[], current: number): number {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return 1;

  const idx = d3.bisectRight(sorted, current) - 1;
  return Math.max(0, Math.min(1, idx / (sorted.length - 1)));
}

export function clampStrength(rawScore: number): number {
  return Math.max(0, Math.min(100, rawScore));
}
