import * as d3 from 'd3';

import { ChartLine } from '../../shared/models/chart.model';

export type RiskRenderMode = 'price' | 'pct';

export type DrawdownPoint = {
  date: Date;
  value: number;
};

export type DrawdownLine = {
  assetId: string;
  assetName: string;
  color: string;
  strokeStyle: 'solid' | 'dashed';
  points: DrawdownPoint[];
  maxDrawdown: number | null;
};

export type StressMarker = {
  assetId: string;
  assetName: string;
  color: string;
  date: Date;
  value: number;
  returnRatio: number;
};

export type MeanBandPoint = {
  date: Date;
  mean: number | null;
  upper: number | null;
  lower: number | null;
};

export type MeanBandLine = {
  assetId: string;
  color: string;
  points: MeanBandPoint[];
};

export function computeDrawdownSeries(
  line: ChartLine,
  mode: RiskRenderMode,
  options?: {
    lineIndex?: number;
    compareEnabled?: boolean;
    drawdownColor?: string;
  }
): DrawdownLine {
  const { lineIndex = 0, compareEnabled = false, drawdownColor = '#6b5dd3' } = options ?? {};
  const points: DrawdownPoint[] = [];
  let runningPeak: number | null = null;
  let runningTrough: number | null = null;

  for (const point of line.points) {
    if (!Number.isFinite(point.value) || point.value == null) {
      continue;
    }

    const valueForDrawdown = toRiskBaseValue(point.value, mode);
    if (valueForDrawdown == null) continue;

    if (runningPeak == null || valueForDrawdown > runningPeak) {
      runningPeak = valueForDrawdown;
    }
    if (runningTrough == null || valueForDrawdown < runningTrough) {
      runningTrough = valueForDrawdown;
    }

    if (
      !Number.isFinite(runningPeak) ||
      !Number.isFinite(runningTrough) ||
      runningPeak <= 0 ||
      runningTrough <= 0
    ) {
      continue;
    }

    const drawdown = Math.max(-1, Math.min(0, valueForDrawdown / runningPeak - 1));
    const drawup = Math.max(0, valueForDrawdown / runningTrough - 1);
    const signedRisk = drawdown < -0.0005 ? drawdown : drawup;
    points.push({ date: point.date, value: signedRisk });
  }

  const maxDrawdown = points.length ? d3.min(points, (point) => point.value) ?? null : null;
  const strokeStyle: 'solid' | 'dashed' = compareEnabled && lineIndex > 0 ? 'dashed' : 'solid';

  return {
    assetId: line.assetId,
    assetName: line.assetName,
    color: drawdownColor,
    strokeStyle,
    points,
    maxDrawdown,
  };
}

export function computeStressMarkers(
  line: ChartLine,
  mode: RiskRenderMode,
  markerColor: string,
  minThreshold = -0.03
): StressMarker[] {
  const stressCandidates: Array<{ date: Date; value: number; returnRatio: number }> = [];
  const negativeReturns: number[] = [];

  for (let i = 1; i < line.points.length; i += 1) {
    const previous = line.points[i - 1];
    const current = line.points[i];

    if (previous.value == null || current.value == null) continue;
    if (!Number.isFinite(previous.value) || !Number.isFinite(current.value)) continue;

    const priorBase = toRiskBaseValue(previous.value, mode);
    const currentBase = toRiskBaseValue(current.value, mode);
    if (priorBase == null || currentBase == null || priorBase === 0) continue;

    const returnRatio = currentBase / priorBase - 1;
    if (!Number.isFinite(returnRatio)) continue;

    if (returnRatio < 0) {
      negativeReturns.push(returnRatio);
      stressCandidates.push({
        date: current.date,
        value: current.value,
        returnRatio,
      });
    }
  }

  if (negativeReturns.length === 0) return [];

  const sortedNegativeReturns = [...negativeReturns].sort((a, b) => a - b);
  const percentileThreshold = d3.quantileSorted(sortedNegativeReturns, 0.05) ?? minThreshold;
  const stressThreshold = Math.min(percentileThreshold, minThreshold);

  return stressCandidates
    .filter((candidate) => candidate.returnRatio <= stressThreshold)
    .map((candidate) => ({
      assetId: line.assetId,
      assetName: line.assetName,
      color: markerColor,
      date: candidate.date,
      value: candidate.value,
      returnRatio: candidate.returnRatio,
    }));
}

export function computeMeanBandLines(
  lines: ChartLine[],
  bandColor: string,
  options?: {
    compareEnabled?: boolean;
    windowSize?: number;
    stdMultiplier?: number;
  }
): MeanBandLine[] {
  const { compareEnabled = false, windowSize = 30, stdMultiplier = 2 } = options ?? {};
  const sourceLines = compareEnabled ? lines.slice(0, 1) : lines;

  return sourceLines.map((line) => ({
    assetId: line.assetId,
    color: bandColor,
    points: computeMeanBandPoints(line.points, windowSize, stdMultiplier),
  }));
}

function computeMeanBandPoints(
  points: Array<{ date: Date; value: number | null }>,
  windowSize: number,
  stdMultiplier: number
): MeanBandPoint[] {
  const bands: MeanBandPoint[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (i < windowSize - 1) {
      bands.push({ date: point.date, mean: null, upper: null, lower: null });
      continue;
    }

    const slice = points.slice(i - windowSize + 1, i + 1);
    const values = slice.map((p) => p.value);

    if (values.some((value) => value == null || !Number.isFinite(value))) {
      bands.push({ date: point.date, mean: null, upper: null, lower: null });
      continue;
    }

    const numeric = values as number[];
    const mean = d3.mean(numeric);
    if (mean == null || !Number.isFinite(mean)) {
      bands.push({ date: point.date, mean: null, upper: null, lower: null });
      continue;
    }

    const variance = d3.mean(numeric, (value) => (value - mean) ** 2) ?? 0;
    const std = Math.sqrt(Math.max(0, variance));

    bands.push({
      date: point.date,
      mean,
      upper: mean + stdMultiplier * std,
      lower: mean - stdMultiplier * std,
    });
  }

  return bands;
}

function toRiskBaseValue(value: number, mode: RiskRenderMode): number | null {
  if (!Number.isFinite(value)) return null;

  if (mode === 'price') {
    return value > 0 ? value : null;
  }

  const indexValue = 100 + value;
  return indexValue > 0 ? indexValue : null;
}
