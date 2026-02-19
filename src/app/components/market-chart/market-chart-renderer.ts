import * as d3 from 'd3';

import { ChartLine } from '../../shared/models/chart.model';
import {
  computeDrawdownSeries,
  computeMeanBandLines,
  computeStressMarkers,
  type DrawdownLine,
  type DrawdownPoint,
  type MeanBandLine,
  type MeanBandPoint,
  type StressMarker,
} from './risk-lens-engine';
import { type PatternSignal, type PatternSignalType } from './pattern-detector';

export type ThemeTokens = {
  ink: string;
  axis: string;
  grid: string;
  chartBg: string;
  chartText: string;
  chartMuted: string;
  patternMomentum: string;
  patternMeanReversion: string;
  patternVolatility: string;
  patternTrend: string;
  patternPattern: string;
  patternHighlight: string;
  riskMean: string;
  riskStress: string;
  riskDrawdown: string;
};

export type RenderMode = 'price' | 'pct';

export type HoverSeriesPoint = {
  assetId: string;
  assetName: string;
  color: string;
  strokeStyle: 'solid' | 'dashed';
  value: number | null;
  riskDirection: 'drawdown' | 'drawup' | null;
  riskValue: number | null;
};

export type HoverInfo = {
  date: Date;
  mode: RenderMode;
  series: HoverSeriesPoint[];
};

export type ChartRenderArgs = {
  host: HTMLDivElement;
  lines: ChartLine[];
  mode: RenderMode;
  tokens: ThemeTokens;
  compareEnabled: boolean;
  riskLensEnabled: boolean;
  showMeanBands: boolean;
  showStressMarkers: boolean;
  showDrawdown: boolean;
  patternSignals: PatternSignal[];
  selectedPatternSignalId: string | null;
  formatPatternSignalDate: (signal: PatternSignal) => string;
  onHoverChange: (info: HoverInfo | null) => void;
};

const HOVER_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const HOVER_PCT_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const DRAWDOWN_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
});

export function renderMarketChart(args: ChartRenderArgs): void {
  const {
    host,
    lines,
    mode,
    tokens,
    compareEnabled,
    riskLensEnabled,
    showMeanBands,
    showStressMarkers,
    showDrawdown,
    patternSignals,
    selectedPatternSignalId,
    formatPatternSignalDate,
    onHoverChange,
  } = args;

  onHoverChange(null);

  const container = d3.select(host);
  container.selectAll('*').remove();

  if (!lines || lines.length === 0) return;

  const allPoints = lines.flatMap((line) => line.points);
  if (allPoints.length === 0) return;

  const validDates = allPoints
    .map((point) => point.date)
    .filter((date) => !Number.isNaN(date.getTime()));

  if (validDates.length === 0) return;

  const drawdownPanelEnabled = riskLensEnabled && showDrawdown;
  const meanBandLines = showMeanBands
    ? computeMeanBandLines(lines, tokens.riskMean, { compareEnabled })
    : [];
  const drawdownLines = drawdownPanelEnabled
    ? lines.map((line, lineIndex) =>
        computeDrawdownSeries(line, mode, {
          lineIndex,
          compareEnabled,
          drawdownColor: line.color,
        })
      )
    : [];
  const stressMarkers = showStressMarkers
    ? lines.flatMap((line) => computeStressMarkers(line, mode, tokens.riskStress))
    : [];
  const numericValues = collectMainChartNumericValues(lines, meanBandLines);

  if (numericValues.length === 0) return;

  const rect = host.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width || 0));
  const height = Math.max(240, Math.floor(rect.height || 0));

  const isNarrow = width < 520;

  const margin = {
    top: 16,
    right: isNarrow ? 14 : 24,
    bottom: isNarrow ? 26 : 28,
    left: isNarrow ? 56 : 62,
  };

  const innerWidth = Math.max(1, width - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top - margin.bottom);
  const panelGap = drawdownPanelEnabled ? (isNarrow ? 20 : 22) : 0;

  let drawdownHeight = 0;
  let mainHeight = innerHeight;

  if (drawdownPanelEnabled) {
    drawdownHeight = Math.max(56, Math.round(innerHeight * 0.28));
    mainHeight = Math.max(128, innerHeight - drawdownHeight - panelGap);

    if (mainHeight + drawdownHeight + panelGap > innerHeight) {
      drawdownHeight = Math.max(48, innerHeight - mainHeight - panelGap);
    }
  }

  const drawdownTop = mainHeight + panelGap;
  const hoverHeight = drawdownPanelEnabled ? Math.max(mainHeight, drawdownTop + drawdownHeight) : mainHeight;

  const xExtent = d3.extent(validDates);
  if (!xExtent[0] || !xExtent[1]) return;

  const yMin = d3.min(numericValues);
  const yMax = d3.max(numericValues);
  if (yMin == null || yMax == null) return;

  const range = yMax - yMin;
  const pad = range === 0 ? Math.max(1, Math.abs(yMax) * 0.01) : range * 0.06;

  const x = d3.scaleTime().domain(xExtent as [Date, Date]).range([0, innerWidth]);

  const y = d3
    .scaleLinear()
    .domain([yMin - pad, yMax + pad])
    .range([mainHeight, 0])
    .nice();
  const [drawdownDomainMin, drawdownDomainMax] = drawdownPanelEnabled
    ? computeSignedRiskDomain(drawdownLines)
    : [-1, 0];
  const drawdownY = d3
    .scaleLinear()
    .domain([drawdownDomainMin, drawdownDomainMax])
    .range([drawdownHeight, 0])
    .nice();

  const xTicks = isNarrow ? 4 : 6;
  const yTicks = isNarrow ? 4 : 5;

  const svg = container
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  svg.append('rect').attr('width', width).attr('height', height).attr('fill', tokens.chartBg);

  svg.append('rect')
    .attr('x', 1.5)
    .attr('y', 1.5)
    .attr('width', Math.max(0, width - 3))
    .attr('height', Math.max(0, height - 3))
    .attr('fill', 'none')
    .attr('stroke', tokens.ink)
    .attr('stroke-width', 3);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  renderPanelBorders({
    g,
    drawdownPanelEnabled,
    innerWidth,
    mainHeight,
    drawdownTop,
    drawdownHeight,
    tokens,
  });
  const mainPlot = g.append('g').attr('class', 'main-plot');
  renderMainGrid(mainPlot, y, yTicks, innerWidth, tokens);

  const linePath = d3
    .line<{ date: Date; value: number | null }>()
    .defined((d) => d.value != null && Number.isFinite(d.value) && !Number.isNaN(d.date.getTime()))
    .x((d) => x(d.date))
    .y((d) => y(d.value as number))
    .curve(d3.curveMonotoneX);

  renderMeanBands(mainPlot, meanBandLines, x, y);
  renderSeriesLines(mainPlot, lines, linePath);
  renderStressMarkers(mainPlot, stressMarkers, showStressMarkers, x, y, isNarrow, tokens);
  renderPatternAnnotations({
    g,
    patternSignals,
    selectedPatternSignalId,
    x,
    y,
    isNarrow,
    tokens,
    formatPatternSignalDate,
  });

  const yTickFormat = getYAxisFormatter(mode);
  const yAxis = mainPlot.append('g').call(
    d3
      .axisLeft(y)
      .ticks(yTicks)
      .tickSizeOuter(0)
      .tickFormat((value) => yTickFormat(Number(value)))
  );
  styleAxis(yAxis, tokens, isNarrow);

  renderBottomPanel({
    g,
    drawdownPanelEnabled,
    innerWidth,
    drawdownTop,
    drawdownHeight,
    drawdownY,
    drawdownLines,
    x,
    xTicks,
    mainHeight,
    isNarrow,
    tokens,
  });

  installHoverBehavior({
    g,
    x,
    innerWidth,
    hoverHeight,
    lines,
    mode,
    drawdownLines,
    drawdownPanelEnabled,
    isNarrow,
    tokens,
    onHoverChange,
  });
}

function renderMainGrid(
  mainPlot: d3.Selection<SVGGElement, unknown, null, undefined>,
  y: d3.ScaleLinear<number, number>,
  yTicks: number,
  innerWidth: number,
  tokens: ThemeTokens
): void {
  mainPlot
    .append('g')
    .attr('class', 'grid')
    .call(
      d3
        .axisLeft(y)
        .ticks(yTicks)
        .tickSize(-innerWidth)
        .tickFormat(() => '')
    )
    .selectAll('line')
    .attr('stroke', tokens.grid)
    .attr('stroke-width', 1.25)
    .attr('stroke-dasharray', '2,3');

  mainPlot.select('.grid .domain').remove();
}

function renderMeanBands(
  mainPlot: d3.Selection<SVGGElement, unknown, null, undefined>,
  meanBandLines: MeanBandLine[],
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>
): void {
  for (const bandLine of meanBandLines) {
    for (const [key, dash] of [
      ['upper', '5,4'],
      ['mean', null],
      ['lower', '5,4'],
    ] as const) {
      const bandPath = d3
        .line<MeanBandPoint>()
        .defined((point) => {
          const value = point[key];
          return value != null && Number.isFinite(value) && !Number.isNaN(point.date.getTime());
        })
        .x((point) => x(point.date))
        .y((point) => y(point[key] as number))
        .curve(d3.curveMonotoneX);

      mainPlot
        .append('path')
        .datum(bandLine.points)
        .attr('fill', 'none')
        .attr('stroke', bandLine.color)
        .attr('stroke-width', key === 'mean' ? 1.8 : 1.15)
        .attr('stroke-opacity', key === 'mean' ? 0.95 : 0.62)
        .attr('stroke-dasharray', key === 'mean' ? '6,3' : dash)
        .attr('d', bandPath);
    }
  }
}

function renderSeriesLines(
  mainPlot: d3.Selection<SVGGElement, unknown, null, undefined>,
  lines: ChartLine[],
  linePath: d3.Line<{ date: Date; value: number | null }>
): void {
  for (const line of lines) {
    mainPlot
      .append('path')
      .datum(line.points)
      .attr('fill', 'none')
      .attr('stroke', line.color)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-dasharray', line.strokeStyle === 'dashed' ? '8,5' : null)
      .attr('d', linePath);
  }
}

function renderStressMarkers(
  mainPlot: d3.Selection<SVGGElement, unknown, null, undefined>,
  stressMarkers: StressMarker[],
  showStressMarkers: boolean,
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  isNarrow: boolean,
  tokens: ThemeTokens
): void {
  if (!showStressMarkers || stressMarkers.length === 0) return;

  const symbolPath = d3.symbol().type(d3.symbolTriangle).size(isNarrow ? 36 : 50);
  const markerGroup = mainPlot.append('g').attr('class', 'stress-markers');

  markerGroup
    .selectAll('path')
    .data(stressMarkers)
    .enter()
    .append('path')
    .attr('d', symbolPath)
    .attr('transform', (d) => `translate(${x(d.date)},${y(d.value)}) rotate(180)`)
    .attr('fill', (d) => d.color)
    .attr('stroke', tokens.chartBg)
    .attr('stroke-width', 2)
    .attr('opacity', 0.95)
    .append('title')
    .text(
      (d) =>
        `${d.assetName} | ${HOVER_DATE_FORMATTER.format(d.date)} | Return ${HOVER_PCT_FORMATTER.format(d.returnRatio * 100)}%`
    );
}

function renderPatternAnnotations(args: {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  patternSignals: PatternSignal[];
  selectedPatternSignalId: string | null;
  x: d3.ScaleTime<number, number>;
  y: d3.ScaleLinear<number, number>;
  isNarrow: boolean;
  tokens: ThemeTokens;
  formatPatternSignalDate: (signal: PatternSignal) => string;
}): void {
  const {
    g,
    patternSignals,
    selectedPatternSignalId,
    x,
    y,
    isNarrow,
    tokens,
    formatPatternSignalDate,
  } = args;

  if (patternSignals.length === 0) return;

  const patternLayers = g.append('g').attr('class', 'pattern-layer');
  const patternRanges = patternSignals.filter(
    (signal) =>
      signal.chartAnnotation.rangeStartDate &&
      signal.chartAnnotation.rangeEndDate &&
      signal.chartAnnotation.rangeLow != null &&
      signal.chartAnnotation.rangeHigh != null
  );

  if (patternRanges.length > 0) {
    patternLayers
      .append('g')
      .attr('class', 'pattern-ranges')
      .selectAll('rect')
      .data(patternRanges)
      .enter()
      .append('rect')
      .attr('x', (signal) => x(signal.chartAnnotation.rangeStartDate as Date))
      .attr('y', (signal) => y(signal.chartAnnotation.rangeHigh as number))
      .attr('width', (signal) =>
        Math.max(1, x(signal.chartAnnotation.rangeEndDate as Date) - x(signal.chartAnnotation.rangeStartDate as Date))
      )
      .attr('height', (signal) =>
        Math.max(1, y(signal.chartAnnotation.rangeLow as number) - y(signal.chartAnnotation.rangeHigh as number))
      )
      .attr('fill', (signal) => getPatternColor(signal.type, tokens))
      .attr('fill-opacity', (signal) => signal.id === selectedPatternSignalId ? 0.22 : 0.13)
      .attr('stroke', (signal) => getPatternColor(signal.type, tokens))
      .attr('stroke-width', (signal) => signal.id === selectedPatternSignalId ? 2 : 1.2)
      .attr('stroke-dasharray', '5,3');
  }

  const markerGroup = patternLayers.append('g').attr('class', 'pattern-markers');
  const symbolForType = (signalType: PatternSignalType) => {
    if (signalType === 'momentum') return d3.symbolTriangle;
    if (signalType === 'meanReversion') return d3.symbolSquare;
    if (signalType === 'volatility') return d3.symbolDiamond;
    if (signalType === 'trend') return d3.symbolCircle;
    return d3.symbolCross;
  };

  markerGroup
    .selectAll('path')
    .data(patternSignals)
    .enter()
    .append('path')
    .attr('d', (signal) =>
      d3
        .symbol()
        .type(symbolForType(signal.type))
        .size(signal.id === selectedPatternSignalId ? 160 : 110)()
    )
    .attr('transform', (signal) => {
      const rotation = signal.type === 'momentum' && signal.direction === 'bearish' ? 180 : 0;
      return `translate(${x(signal.chartAnnotation.date)},${y(signal.chartAnnotation.value)}) rotate(${rotation})`;
    })
    .attr('fill', (signal) => getPatternColor(signal.type, tokens))
    .attr('stroke', tokens.chartBg)
    .attr('stroke-width', (signal) => signal.id === selectedPatternSignalId ? 2.7 : 2)
    .attr('opacity', (signal) => signal.id === selectedPatternSignalId ? 1 : 0.9)
    .append('title')
    .text(
      (signal) =>
        `${signal.name} | ${formatPatternSignalDate(signal)} | Strength ${Math.round(signal.strength)}`
    );

  const labelGroup = patternLayers.append('g').attr('class', 'pattern-labels');
  labelGroup
    .selectAll('text')
    .data(patternSignals)
    .enter()
    .append('text')
    .attr('x', (signal) => x(signal.chartAnnotation.date) + 7)
    .attr('y', (signal) => y(signal.chartAnnotation.value) - 8)
    .attr('fill', (signal) =>
      signal.id === selectedPatternSignalId ? tokens.patternHighlight : getPatternColor(signal.type, tokens)
    )
    .attr('font-size', isNarrow ? 8.5 : 9.5)
    .attr('font-weight', 900)
    .text((signal) => signal.chartAnnotation.label);
}

function renderBottomPanel(args: {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  drawdownPanelEnabled: boolean;
  innerWidth: number;
  drawdownTop: number;
  drawdownHeight: number;
  drawdownY: d3.ScaleLinear<number, number>;
  drawdownLines: DrawdownLine[];
  x: d3.ScaleTime<number, number>;
  xTicks: number;
  mainHeight: number;
  isNarrow: boolean;
  tokens: ThemeTokens;
}): void {
  const {
    g,
    drawdownPanelEnabled,
    innerWidth,
    drawdownTop,
    drawdownHeight,
    drawdownY,
    drawdownLines,
    x,
    xTicks,
    mainHeight,
    isNarrow,
    tokens,
  } = args;

  if (drawdownPanelEnabled) {
    const drawdownPlot = g.append('g').attr('class', 'drawdown-plot').attr('transform', `translate(0,${drawdownTop})`);

    drawdownPlot
      .append('g')
      .attr('class', 'drawdown-grid')
      .call(
        d3
          .axisLeft(drawdownY)
          .ticks(isNarrow ? 3 : 4)
          .tickSize(-innerWidth)
          .tickFormat(() => '')
      )
      .selectAll('line')
      .attr('stroke', tokens.grid)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,3');

    drawdownPlot.select('.drawdown-grid .domain').remove();

    drawdownPlot
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', drawdownY(0))
      .attr('y2', drawdownY(0))
      .attr('stroke', tokens.axis)
      .attr('stroke-width', 2);

    const drawdownPath = d3
      .line<DrawdownPoint>()
      .defined((d) => Number.isFinite(d.value) && !Number.isNaN(d.date.getTime()))
      .x((d) => x(d.date))
      .y((d) => drawdownY(d.value))
      .curve(d3.curveMonotoneX);

    for (const drawdownLine of drawdownLines) {
      drawdownPlot
        .append('path')
        .datum(drawdownLine.points)
        .attr('fill', 'none')
        .attr('stroke', drawdownLine.color)
        .attr('stroke-width', 2)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('stroke-dasharray', drawdownLine.strokeStyle === 'dashed' ? '8,5' : null)
        .attr('d', drawdownPath);

      const maxPoint = findMaxDrawdownPoint(drawdownLine.points);
      if (maxPoint) {
        drawdownPlot
          .append('circle')
          .attr('cx', x(maxPoint.date))
          .attr('cy', drawdownY(maxPoint.value))
          .attr('r', isNarrow ? 2.8 : 3.5)
          .attr('fill', drawdownLine.color)
          .attr('stroke', tokens.chartBg)
          .attr('stroke-width', 1.2);
      }
    }

    const drawdownYAxis = drawdownPlot.append('g').call(
      d3
        .axisLeft(drawdownY)
        .ticks(isNarrow ? 3 : 4)
        .tickSizeOuter(0)
        .tickFormat((value) => DRAWDOWN_FORMATTER.format(Number(value)))
    );
    styleAxis(drawdownYAxis, tokens, isNarrow);

    const drawdownXAxis = drawdownPlot
      .append('g')
      .attr('transform', `translate(0,${drawdownHeight})`)
      .call(d3.axisBottom(x).ticks(xTicks).tickSizeOuter(0));
    styleAxis(drawdownXAxis, tokens, isNarrow);

    if (isNarrow) {
      drawdownXAxis.selectAll<SVGTextElement, unknown>('.tick text').attr('dy', '0.9em');
    }
    return;
  }

  const xAxis = g
    .append('g')
    .attr('transform', `translate(0,${mainHeight})`)
    .call(d3.axisBottom(x).ticks(xTicks).tickSizeOuter(0));
  styleAxis(xAxis, tokens, isNarrow);

  if (isNarrow) {
    xAxis.selectAll<SVGTextElement, unknown>('.tick text').attr('dy', '0.9em');
  }
}

function renderPanelBorders(args: {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  drawdownPanelEnabled: boolean;
  innerWidth: number;
  mainHeight: number;
  drawdownTop: number;
  drawdownHeight: number;
  tokens: ThemeTokens;
}): void {
  const {
    g,
    drawdownPanelEnabled,
    innerWidth,
    mainHeight,
    drawdownTop,
    drawdownHeight,
    tokens,
  } = args;

  const strokeInset = 1.25;
  const strokeWidth = 2.5;
  const borderWidth = Math.max(0, innerWidth - strokeInset * 2);

  g.append('rect')
    .attr('x', strokeInset)
    .attr('y', strokeInset)
    .attr('width', borderWidth)
    .attr('height', Math.max(0, mainHeight - strokeInset * 2))
    .attr('fill', 'none')
    .attr('stroke', tokens.ink)
    .attr('stroke-width', strokeWidth);

  if (!drawdownPanelEnabled) return;

  g.append('rect')
    .attr('x', strokeInset)
    .attr('y', drawdownTop + strokeInset)
    .attr('width', borderWidth)
    .attr('height', Math.max(0, drawdownHeight - strokeInset * 2))
    .attr('fill', 'none')
    .attr('stroke', tokens.ink)
    .attr('stroke-width', strokeWidth);
}

function getPatternColor(signalType: PatternSignalType, tokens: ThemeTokens): string {
  if (signalType === 'momentum') return tokens.patternMomentum;
  if (signalType === 'meanReversion') return tokens.patternMeanReversion;
  if (signalType === 'volatility') return tokens.patternVolatility;
  if (signalType === 'trend') return tokens.patternTrend;
  return tokens.patternPattern;
}

function styleAxis(
  axisSel: d3.Selection<SVGGElement, unknown, null, undefined>,
  tokens: ThemeTokens,
  isNarrow: boolean
): void {
  axisSel.selectAll('.domain').attr('stroke', tokens.axis).attr('stroke-width', 2);
  axisSel.selectAll('.tick line').attr('stroke', tokens.axis).attr('stroke-width', 2);

  axisSel
    .selectAll('.tick text')
    .attr('fill', tokens.chartText)
    .attr('font-size', isNarrow ? 10 : 11)
    .attr('font-weight', 900);
}

function collectMainChartNumericValues(lines: ChartLine[], meanBandLines: MeanBandLine[]): number[] {
  const pointValues = lines
    .flatMap((line) => line.points)
    .map((point) => point.value)
    .filter((value): value is number => value != null && Number.isFinite(value));

  if (!meanBandLines.length) {
    return pointValues;
  }

  const bandValues = meanBandLines
    .flatMap((line) => line.points)
    .flatMap((point) => [point.mean, point.upper, point.lower])
    .filter((value): value is number => value != null && Number.isFinite(value));

  return [...pointValues, ...bandValues];
}

function findMaxDrawdownPoint(points: DrawdownPoint[]): DrawdownPoint | null {
  if (!points.length) return null;

  return points.reduce<DrawdownPoint | null>((worst, point) => {
    if (!worst) return point;
    return point.value < worst.value ? point : worst;
  }, null);
}

function installHoverBehavior(args: {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  x: d3.ScaleTime<number, number>;
  innerWidth: number;
  hoverHeight: number;
  lines: ChartLine[];
  mode: RenderMode;
  drawdownLines: DrawdownLine[];
  drawdownPanelEnabled: boolean;
  isNarrow: boolean;
  tokens: ThemeTokens;
  onHoverChange: (info: HoverInfo | null) => void;
}): void {
  const {
    g,
    x,
    innerWidth,
    hoverHeight,
    lines,
    mode,
    drawdownLines,
    drawdownPanelEnabled,
    isNarrow,
    tokens,
    onHoverChange,
  } = args;

  if (isNarrow || !isDesktopHoverCapable()) {
    return;
  }

  const allTimestamps = Array.from(
    new Set(
      lines
        .flatMap((line) => line.points)
        .map((point) => point.date.getTime())
        .filter((ts) => Number.isFinite(ts))
    )
  ).sort((a, b) => a - b);

  if (!allTimestamps.length) return;

  const valueByLineAndTimestamp = new Map<string, Map<number, number | null>>();
  const riskByLineAndTimestamp = new Map<
    string,
    Map<number, { direction: 'drawdown' | 'drawup'; value: number }>
  >();
  for (const line of lines) {
    const byTimestamp = new Map<number, number | null>();
    for (const point of line.points) {
      byTimestamp.set(point.date.getTime(), point.value);
    }
    valueByLineAndTimestamp.set(line.assetId, byTimestamp);
  }

  if (drawdownPanelEnabled) {
    for (const drawdownLine of drawdownLines) {
      const byTimestamp = new Map<number, { direction: 'drawdown' | 'drawup'; value: number }>();
      for (const point of drawdownLine.points) {
        if (!Number.isFinite(point.value)) continue;
        byTimestamp.set(point.date.getTime(), {
          direction: point.value < -0.0005 ? 'drawdown' : 'drawup',
          value: point.value,
        });
      }
      riskByLineAndTimestamp.set(drawdownLine.assetId, byTimestamp);
    }
  }

  const hoverLayer = g.append('g').attr('class', 'hover-layer');
  const hoverRule = hoverLayer
    .append('line')
    .attr('y1', 0)
    .attr('y2', hoverHeight)
    .attr('stroke', tokens.axis)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '4,4')
    .style('display', 'none');

  const interactionZone = g
    .append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', innerWidth)
    .attr('height', hoverHeight)
    .attr('fill', 'transparent')
    .style('cursor', 'crosshair')
    .style('pointer-events', 'all');

  const setHoverFromTimestamp = (timestamp: number): void => {
    const hoverDate = new Date(timestamp);
    const hoverX = x(hoverDate);

    hoverRule.attr('x1', hoverX).attr('x2', hoverX).style('display', null);

    const series: HoverSeriesPoint[] = lines.map((line) => ({
      assetId: line.assetId,
      assetName: line.assetName,
      color: line.color,
      strokeStyle: line.strokeStyle,
      value: valueByLineAndTimestamp.get(line.assetId)?.get(timestamp) ?? null,
      riskDirection: riskByLineAndTimestamp.get(line.assetId)?.get(timestamp)?.direction ?? null,
      riskValue: riskByLineAndTimestamp.get(line.assetId)?.get(timestamp)?.value ?? null,
    }));

    onHoverChange({ date: hoverDate, mode, series });
  };

  interactionZone.on('mousemove', (event: MouseEvent) => {
    const [mouseX] = d3.pointer(event, g.node());
    const clampedX = Math.max(0, Math.min(innerWidth, mouseX));
    const hoveredTimestamp = x.invert(clampedX).getTime();
    const nearestIndex = d3.bisectCenter(allTimestamps, hoveredTimestamp);
    const nearestTimestamp = allTimestamps[nearestIndex];

    if (nearestTimestamp == null) return;
    setHoverFromTimestamp(nearestTimestamp);
  });

  interactionZone.on('mouseleave', () => {
    hoverRule.style('display', 'none');
    onHoverChange(null);
  });
}

function computeSignedRiskDomain(drawdownLines: DrawdownLine[]): [number, number] {
  const values = drawdownLines
    .flatMap((line) => line.points)
    .map((point) => point.value)
    .filter((value): value is number => Number.isFinite(value));

  if (values.length === 0) return [-1, 0];

  let minValue = d3.min(values) ?? -1;
  let maxValue = d3.max(values) ?? 0;
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return [-1, 0];

  minValue = Math.min(minValue, 0);
  maxValue = Math.max(maxValue, 0);

  const span = maxValue - minValue;
  const pad = span === 0 ? Math.max(0.04, Math.abs(maxValue || minValue) * 0.2) : span * 0.08;
  const domainMin = minValue - pad;
  const domainMax = maxValue + pad;

  if (domainMin === domainMax) {
    return [domainMin - 0.05, domainMax + 0.05];
  }

  return [domainMin, domainMax];
}

function isDesktopHoverCapable(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function getYAxisFormatter(mode: RenderMode): (value: number) => string {
  if (mode === 'price') {
    const fmt = d3.format('~s');
    return (value) => `$${fmt(value)}`;
  }

  const fmt = d3.format('.2~f');
  return (value) => `${fmt(value)}%`;
}
