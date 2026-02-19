import * as d3 from 'd3';

import { getPatternNarrative } from './pattern-detector.explanations';
import {
  clampStrength,
  computeRsiSeries,
  computeStepReturns,
  percentileRank,
  rollingStdSeries,
  simpleMovingAverageSeries,
} from './pattern-detector.math';

export type PatternSignalType = 'momentum' | 'meanReversion' | 'volatility' | 'trend' | 'pattern';
export type PatternSensitivity = 'conservative' | 'normal' | 'sensitive';
export type PatternSortMode = 'recency' | 'strength';
export type PatternDirection = 'bullish' | 'bearish' | 'neutral';

export type AnalysisPoint = {
  date: Date;
  value: number;
  index: number;
};

export type PatternSignal = {
  id: string;
  type: PatternSignalType;
  name: string;
  shortLabel: string;
  direction: PatternDirection;
  date: Date;
  startDate?: Date;
  endDate?: Date;
  strength: number;
  details: Record<string, string | number>;
  explanations: string[];
  interpretation: string[];
  chartAnnotation: {
    date: Date;
    value: number;
    label: string;
    rangeStartDate?: Date;
    rangeEndDate?: Date;
    rangeLow?: number;
    rangeHigh?: number;
  };
};

export type PatternTypeOption = {
  key: PatternSignalType;
  label: string;
};

export const PATTERN_TYPE_OPTIONS: PatternTypeOption[] = [
  { key: 'momentum', label: 'Momentum' },
  { key: 'meanReversion', label: 'Mean reversion' },
  { key: 'volatility', label: 'Volatility' },
  { key: 'trend', label: 'Trend / breakouts' },
  { key: 'pattern', label: 'Classic chart patterns' },
];

export function toAnalysisSeries(points: Array<{ date: Date; value: number | null }>): AnalysisPoint[] {
  const result: AnalysisPoint[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point.value == null || !Number.isFinite(point.value)) continue;
    if (Number.isNaN(point.date.getTime())) continue;

    result.push({
      date: point.date,
      value: point.value,
      index: i,
    });
  }

  return result;
}

export function detectPatternSignals(
  points: AnalysisPoint[],
  sensitivity: PatternSensitivity
): PatternSignal[] {
  return [
    ...detectMovingAverageCrossSignals(points, sensitivity),
    ...detectRsiSignals(points, sensitivity),
    ...detectBollingerSignals(points, sensitivity),
    ...detectRangeBreakoutSignals(points, sensitivity),
    ...detectVolatilitySpikeSignals(points, sensitivity),
  ];
}

function detectMovingAverageCrossSignals(
  points: AnalysisPoint[],
  sensitivity: PatternSensitivity
): PatternSignal[] {
  const values = points.map((point) => point.value);
  const paramsBySensitivity = {
    conservative: { shortLength: 50, longLength: 200, confirmation: 2 },
    normal: { shortLength: 50, longLength: 200, confirmation: 1 },
    sensitive: { shortLength: 20, longLength: 50, confirmation: 1 },
  } as const;

  const base = paramsBySensitivity[sensitivity];
  let shortLength: number = base.shortLength;
  let longLength: number = base.longLength;
  let adjustedForDataLimits = false;

  if (values.length < longLength + 3) {
    adjustedForDataLimits = true;
    longLength = Math.max(24, Math.floor(values.length * 0.62));
    shortLength = Math.max(8, Math.floor(longLength * 0.42));
  }

  if (values.length < longLength + 2 || longLength <= shortLength + 2) {
    return [];
  }

  const shortMa = simpleMovingAverageSeries(values, shortLength);
  const longMa = simpleMovingAverageSeries(values, longLength);
  const signals: PatternSignal[] = [];

  for (let i = 1; i < points.length; i += 1) {
    const prevShort = shortMa[i - 1];
    const prevLong = longMa[i - 1];
    const currShort = shortMa[i];
    const currLong = longMa[i];
    if (prevShort == null || prevLong == null || currShort == null || currLong == null) continue;

    const prevDiff = prevShort - prevLong;
    const currDiff = currShort - currLong;
    const bullishCross = prevDiff <= 0 && currDiff > 0;
    const bearishCross = prevDiff >= 0 && currDiff < 0;
    if (!bullishCross && !bearishCross) continue;

    const persists = crossPersists(shortMa, longMa, i, base.confirmation, bullishCross ? 'above' : 'below');
    if (!persists) continue;

    const spread = Math.abs(currDiff);
    const valueScale = Math.max(1e-6, Math.abs(points[i].value));
    let strength = clampStrength((spread / valueScale) * 2500 + (base.confirmation > 1 ? 10 : 0));
    if (adjustedForDataLimits) {
      strength = clampStrength(strength - 18);
    }

    const direction: PatternDirection = bullishCross ? 'bullish' : 'bearish';
    const signalDate = points[i].date;
    const crossoverType = bullishCross ? 'Golden cross' : 'Death cross';
    const narrative = getPatternNarrative('movingAverageCrossover');

    signals.push({
      id: `ma-${signalDate.getTime()}-${direction}-${shortLength}-${longLength}`,
      type: 'momentum',
      name: `Moving Average Crossover (${crossoverType})`,
      shortLabel: 'MA crossover',
      direction,
      date: signalDate,
      strength,
      details: {
        shortMA: Number(currShort.toFixed(3)),
        longMA: Number(currLong.toFixed(3)),
        shortLength,
        longLength,
      },
      explanations: narrative.explanations,
      interpretation: narrative.interpretation,
      chartAnnotation: {
        date: signalDate,
        value: points[i].value,
        label: 'MA crossover',
      },
    });
  }

  return signals;
}

function crossPersists(
  shortMa: Array<number | null>,
  longMa: Array<number | null>,
  index: number,
  confirmationLength: number,
  side: 'above' | 'below'
): boolean {
  const checks = Math.max(1, confirmationLength);

  for (let offset = 0; offset < checks; offset += 1) {
    const i = index + offset;
    const shortValue = shortMa[i];
    const longValue = longMa[i];
    if (shortValue == null || longValue == null) return false;

    const diff = shortValue - longValue;
    if (side === 'above' && diff <= 0) return false;
    if (side === 'below' && diff >= 0) return false;
  }

  return true;
}

function detectRsiSignals(points: AnalysisPoint[], sensitivity: PatternSensitivity): PatternSignal[] {
  if (points.length < 18) return [];

  const values = points.map((point) => point.value);
  const rsi = computeRsiSeries(values, 14);
  const thresholds = {
    conservative: { lower: 25, upper: 75 },
    normal: { lower: 30, upper: 70 },
    sensitive: { lower: 35, upper: 65 },
  }[sensitivity];

  const signals: PatternSignal[] = [];

  for (let i = 1; i < points.length; i += 1) {
    const prev = rsi[i - 1];
    const current = rsi[i];
    if (prev == null || current == null) continue;

    const oversold = prev >= thresholds.lower && current < thresholds.lower;
    const overbought = prev <= thresholds.upper && current > thresholds.upper;
    if (!oversold && !overbought) continue;

    const direction: PatternDirection = oversold ? 'bullish' : 'bearish';
    const threshold = oversold ? thresholds.lower : thresholds.upper;
    const distance = oversold ? thresholds.lower - current : current - thresholds.upper;
    const strength = clampStrength(30 + (distance / Math.max(1, threshold)) * 200);
    const signalDate = points[i].date;
    const narrative = getPatternNarrative('rsiExtremes');

    signals.push({
      id: `rsi-${signalDate.getTime()}-${direction}`,
      type: 'meanReversion',
      name: oversold ? 'RSI Oversold' : 'RSI Overbought',
      shortLabel: oversold ? 'RSI oversold' : 'RSI overbought',
      direction,
      date: signalDate,
      strength,
      details: {
        rsi: Number(current.toFixed(2)),
        threshold,
        length: 14,
      },
      explanations: narrative.explanations,
      interpretation: narrative.interpretation,
      chartAnnotation: {
        date: signalDate,
        value: points[i].value,
        label: oversold ? 'RSI OS' : 'RSI OB',
      },
    });
  }

  return signals;
}

function detectBollingerSignals(
  points: AnalysisPoint[],
  sensitivity: PatternSensitivity
): PatternSignal[] {
  if (points.length < 24) return [];

  const values = points.map((point) => point.value);
  const ma = simpleMovingAverageSeries(values, 20);
  const std = rollingStdSeries(values, 20);
  const widths: Array<number | null> = ma.map((mean, i) => {
    const sigma = std[i];
    if (mean == null || sigma == null) return null;
    const scale = Math.max(1e-6, Math.abs(mean));
    return (4 * sigma) / scale;
  });

  const lowThreshold = { conservative: 0.08, normal: 0.1, sensitive: 0.15 }[sensitivity];
  const highThreshold = { conservative: 0.95, normal: 0.9, sensitive: 0.8 }[sensitivity];
  const percentileWindow = 90;

  const signals: PatternSignal[] = [];

  for (let i = 20; i < points.length; i += 1) {
    const currentWidth = widths[i];
    const prevWidth = widths[i - 1];
    if (currentWidth == null || prevWidth == null) continue;

    const start = Math.max(0, i - percentileWindow);
    const history = widths.slice(start, i + 1).filter((value): value is number => value != null && Number.isFinite(value));
    if (history.length < 20) continue;

    const percentile = percentileRank(history, currentWidth);
    const prevPercentile = percentileRank(history, prevWidth);

    const isSqueeze = percentile < lowThreshold && prevPercentile >= lowThreshold;
    const widthJumpRatio = prevWidth > 0 ? currentWidth / prevWidth : 1;
    const isExpansion =
      percentile > highThreshold &&
      (prevPercentile <= highThreshold || widthJumpRatio > 1.17);

    if (!isSqueeze && !isExpansion) continue;

    const direction: PatternDirection = 'neutral';
    const signalDate = points[i].date;
    const percentilePct = percentile * 100;
    const narrative = getPatternNarrative('bollingerRegime');
    const strength = isSqueeze
      ? clampStrength(35 + ((lowThreshold - percentile) / Math.max(0.02, lowThreshold)) * 100)
      : clampStrength(
          40 +
            ((percentile - highThreshold) / Math.max(0.02, 1 - highThreshold)) * 90 +
            Math.max(0, (widthJumpRatio - 1) * 25)
        );

    signals.push({
      id: `bb-${signalDate.getTime()}-${isSqueeze ? 'squeeze' : 'expansion'}`,
      type: 'volatility',
      name: isSqueeze ? 'Bollinger Squeeze' : 'Bollinger Expansion',
      shortLabel: isSqueeze ? 'BB squeeze' : 'BB expansion',
      direction,
      date: signalDate,
      strength,
      details: {
        bandWidth: Number(currentWidth.toFixed(4)),
        percentile: Number(percentilePct.toFixed(1)),
      },
      explanations: narrative.explanations,
      interpretation: narrative.interpretation,
      chartAnnotation: {
        date: signalDate,
        value: points[i].value,
        label: isSqueeze ? 'BB squeeze' : 'BB expand',
      },
    });
  }

  return signals;
}

function detectRangeBreakoutSignals(
  points: AnalysisPoint[],
  sensitivity: PatternSensitivity
): PatternSignal[] {
  if (points.length < 16) return [];

  const lookbackBySensitivity = { conservative: 50, normal: 20, sensitive: 10 };
  const breakoutPctBySensitivity = { conservative: 0.01, normal: 0.007, sensitive: 0.005 };
  const lookback = Math.min(points.length - 2, lookbackBySensitivity[sensitivity]);
  if (lookback < 8) return [];

  const returns = computeStepReturns(points.map((point) => point.value));
  const rollingVol = rollingStdSeries(returns.map((value) => value ?? 0), 14);
  const breakoutPct = breakoutPctBySensitivity[sensitivity];

  const signals: PatternSignal[] = [];

  for (let i = lookback; i < points.length; i += 1) {
    const window = points.slice(i - lookback, i);
    if (window.length < lookback) continue;

    const high = d3.max(window, (point) => point.value);
    const low = d3.min(window, (point) => point.value);
    if (high == null || low == null) continue;

    const current = points[i].value;
    const scale = Math.max(1, Math.abs(high), Math.abs(low));
    const volProxy = rollingVol[i] ?? 0;
    const requiredMove = scale * breakoutPct + scale * volProxy * 0.5;

    const upDistance = current - high;
    const downDistance = low - current;
    const bullish = upDistance > requiredMove;
    const bearish = downDistance > requiredMove;
    if (!bullish && !bearish) continue;

    const direction: PatternDirection = bullish ? 'bullish' : 'bearish';
    const moveRatio = bullish ? upDistance / Math.max(requiredMove, 1e-6) : downDistance / Math.max(requiredMove, 1e-6);
    const strength = clampStrength(40 + moveRatio * 26);
    const signalDate = points[i].date;
    const narrative = getPatternNarrative('rangeBreakout');

    signals.push({
      id: `range-${signalDate.getTime()}-${direction}-${lookback}`,
      type: 'trend',
      name: bullish ? 'Range Breakout (Upside)' : 'Range Breakout (Downside)',
      shortLabel: bullish ? 'Breakout up' : 'Breakout down',
      direction,
      date: signalDate,
      startDate: points[i - lookback].date,
      endDate: signalDate,
      strength,
      details: {
        lookback,
        rangeHigh: Number(high.toFixed(3)),
        rangeLow: Number(low.toFixed(3)),
        breakoutDistance: Number((bullish ? upDistance : downDistance).toFixed(3)),
      },
      explanations: narrative.explanations,
      interpretation: narrative.interpretation,
      chartAnnotation: {
        date: signalDate,
        value: current,
        label: bullish ? 'Breakout +' : 'Breakout -',
        rangeStartDate: points[i - lookback].date,
        rangeEndDate: signalDate,
        rangeLow: low,
        rangeHigh: high,
      },
    });
  }

  return signals;
}

function detectVolatilitySpikeSignals(
  points: AnalysisPoint[],
  sensitivity: PatternSensitivity
): PatternSignal[] {
  if (points.length < 16) return [];

  const returns = computeStepReturns(points.map((point) => point.value));
  const absReturns = returns.map((value) => Math.abs(value ?? 0));
  const rollingVol = rollingStdSeries(absReturns, 20);
  const percentileWindow = 80;
  const thresholdBySensitivity = {
    conservative: 0.95,
    normal: 0.9,
    sensitive: 0.8,
  }[sensitivity];

  const signals: PatternSignal[] = [];

  for (let i = 21; i < points.length; i += 1) {
    const currentVol = rollingVol[i];
    const prevVol = rollingVol[i - 1];
    if (currentVol == null || prevVol == null) continue;

    const start = Math.max(0, i - percentileWindow);
    const volHistory = rollingVol
      .slice(start, i + 1)
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (volHistory.length < 24) continue;

    const percentile = percentileRank(volHistory, currentVol);
    const prevPercentile = percentileRank(volHistory, prevVol);
    if (!(percentile > thresholdBySensitivity && prevPercentile <= thresholdBySensitivity)) continue;

    const jumpRatio = prevVol > 1e-6 ? currentVol / prevVol : 1;
    const strength = clampStrength(
      35 +
        ((percentile - thresholdBySensitivity) / Math.max(0.02, 1 - thresholdBySensitivity)) * 90 +
        Math.max(0, (jumpRatio - 1) * 30)
    );
    const signalDate = points[i].date;
    const narrative = getPatternNarrative('volatilitySpike');

    signals.push({
      id: `vol-${signalDate.getTime()}`,
      type: 'volatility',
      name: 'Volatility Spike',
      shortLabel: 'Vol spike',
      direction: 'neutral',
      date: signalDate,
      strength,
      details: {
        percentile: Number((percentile * 100).toFixed(1)),
        jumpRatio: Number(jumpRatio.toFixed(2)),
        volatility: Number(currentVol.toFixed(4)),
      },
      explanations: narrative.explanations,
      interpretation: narrative.interpretation,
      chartAnnotation: {
        date: signalDate,
        value: points[i].value,
        label: 'Vol spike',
      },
    });
  }

  return signals;
}
