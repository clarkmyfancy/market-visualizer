import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import * as d3 from 'd3';

import {
  ChartLine,
  MarketService,
} from '../../core/services/market.service';
import { TimeRange } from '../../shared/models/market.model';

type ThemeTokens = {
  ink: string;
  axis: string;
  grid: string;
  chartBg: string;
  chartText: string;
  chartMuted: string;
  riskMean: string;
  riskStress: string;
  riskDrawdown: string;
};

type RenderMode = 'price' | 'pct';
type RiskFeatureKey = 'mean' | 'stress' | 'drawdown';

type HoverSeriesPoint = {
  assetId: string;
  assetName: string;
  color: string;
  strokeStyle: 'solid' | 'dashed';
  value: number | null;
};

type HoverInfo = {
  date: Date;
  mode: RenderMode;
  series: HoverSeriesPoint[];
};

type DrawdownPoint = {
  date: Date;
  value: number;
};

type DrawdownLine = {
  assetId: string;
  assetName: string;
  color: string;
  strokeStyle: 'solid' | 'dashed';
  points: DrawdownPoint[];
  maxDrawdown: number | null;
};

type DrawdownStat = {
  assetId: string;
  assetName: string;
  strokeStyle: 'solid' | 'dashed';
  maxDrawdown: number;
};

type StressMarker = {
  assetId: string;
  assetName: string;
  color: string;
  date: Date;
  value: number;
  returnRatio: number;
};

type MeanBandPoint = {
  date: Date;
  mean: number | null;
  upper: number | null;
  lower: number | null;
};

type MeanBandLine = {
  assetId: string;
  color: string;
  points: MeanBandPoint[];
};

type RiskTipCard = {
  key: RiskFeatureKey;
  title: string;
  summary: string;
  whatItIs: string;
  bullets: string[];
  commonMistake?: string;
};

@Component({
  selector: 'app-market-chart',
  standalone: true,
  templateUrl: './market-chart.component.html',
  styleUrls: ['./market-chart.component.scss'],
})
export class MarketChartComponent implements AfterViewInit, OnDestroy {
  @ViewChild('chartContainer', { static: true })
  chartContainer!: ElementRef<HTMLDivElement>;

  readonly marketService = inject(MarketService);

  readonly ranges = computed(() => this.marketService.getVisibleRangeOptions());
  readonly compareAssetOptions = computed(() => this.marketService.getCompareAssetOptions());
  readonly chartLines = this.marketService.chartLines;

  private readonly usdFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
  private readonly hoverDateFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  private readonly hoverPctFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  });
  private readonly hoverPriceFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
  private readonly drawdownFormatter = new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  });

  private readonly viewReady = signal(false);
  readonly hoverInfo = signal<HoverInfo | null>(null);
  readonly riskLensEnabled = signal(false);
  readonly showMeanBands = signal(true);
  readonly showStressMarkers = signal(true);
  readonly riskTipCards: RiskTipCard[] = [
    {
      key: 'mean',
      title: 'Mean-reversion bands',
      summary: 'Rolling average with upper/lower variability bands.',
      whatItIs: 'A rolling average with an upper and lower band based on recent variability (standard deviation).',
      bullets: [
        'The middle line is the recent "typical" level (rolling mean).',
        'Bands widen when the series gets more volatile and tighten when it calms down.',
        'Values outside the bands indicate an unusually large deviation relative to the recent window.',
      ],
      commonMistake: 'Treating band breaks as guaranteed reversals; they are a context signal, not a prediction.',
    },
    {
      key: 'stress',
      title: 'Stress markers',
      summary: 'Flags for unusually large negative point-to-point moves.',
      whatItIs: 'Flags for unusually large negative moves between consecutive points.',
      bullets: [
        'Each marker highlights a sharp drop versus the prior point.',
        'Clusters of markers typically indicate turbulent periods.',
        'Use them to locate "panic" zones quickly, then inspect what happened around them.',
      ],
      commonMistake: 'Over-weighting single markers; one sharp move can be noise and patterns matter more.',
    },
    {
      key: 'drawdown',
      title: 'Drawdown',
      summary: 'Percent decline from running peak over time.',
      whatItIs: 'The percent drop from the most recent peak to the current value over time.',
      bullets: [
        '0% means the series is at a peak.',
        'More negative values mean deeper decline from the peak.',
        '"Max drawdown" in the range is the worst peak-to-trough drop.',
      ],
      commonMistake: 'Comparing drawdowns across different series without considering volatility and time window.',
    },
  ];
  readonly drawdownStats = computed<DrawdownStat[]>(() => {
    const lines = this.chartLines();
    const mode = this.currentRenderMode();

    return lines
      .map((line, lineIndex) => {
        const drawdown = this.computeDrawdownSeries(line, mode, lineIndex);
        if (drawdown.maxDrawdown == null) return null;

        return {
          assetId: line.assetId,
          assetName: line.assetName,
          strokeStyle: drawdown.strokeStyle,
          maxDrawdown: drawdown.maxDrawdown,
        } as DrawdownStat;
      })
      .filter((stat): stat is DrawdownStat => stat != null);
  });
  private resizeObserver?: ResizeObserver;

  private themeObserver?: MutationObserver;
  private mediaQueryList?: MediaQueryList;
  private queuedThemeRerender = false;

  private readonly renderEffect = effect(() => {
    if (!this.viewReady()) return;

    const lines = this.chartLines();
    const mode = this.currentRenderMode();
    const lensEnabled = this.riskLensEnabled();
    const meanBands = this.showMeanBands();
    const stressMarkers = this.showStressMarkers();
    void lensEnabled;
    void meanBands;
    void stressMarkers;

    this.render(lines, mode);
  }, { allowSignalWrites: true });

  ngAfterViewInit(): void {
    this.viewReady.set(true);

    this.resizeObserver = new ResizeObserver(() => {
      const lines = untracked(() => this.chartLines());
      const mode = untracked(() => this.currentRenderMode());
      this.render(lines, mode);
    });

    this.resizeObserver.observe(this.chartContainer.nativeElement);

    this.installThemeObservers();
    this.requestThemeRerender();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();

    if (this.mediaQueryList) {
      try {
        this.mediaQueryList.removeEventListener('change', this.onSystemThemeChange);
      } catch {
        this.mediaQueryList.removeListener?.(this.onSystemThemeChange);
      }
    }
  }

  setRange(r: TimeRange): void {
    if (this.isRangeDisabled(r)) return;
    this.marketService.setRange(r);
  }

  setCompareEnabled(enabled: boolean): void {
    this.marketService.setCompareEnabled(enabled);
  }

  setSecondaryAsset(assetId: string): void {
    this.marketService.setSecondaryAsset(assetId);
  }

  setRiskLensEnabled(enabled: boolean): void {
    this.riskLensEnabled.set(enabled);
  }

  setMeanBandsEnabled(enabled: boolean): void {
    this.showMeanBands.set(enabled);
  }

  setStressMarkersEnabled(enabled: boolean): void {
    this.showStressMarkers.set(enabled);
  }

  isRangeDisabled(r: TimeRange): boolean {
    const asset = this.marketService.selectedAsset();
    if (asset?.id !== 'austin-real-estate') return false;
    return r === 'week' || r === 'month';
  }

  headerLabel(): string {
    if (this.marketService.compareEnabled()) return 'Compare';

    const asset = this.marketService.selectedAsset();
    if (asset?.id === 'austin-real-estate') return this.marketService.austinMetricLabel();
    return 'Asset';
  }

  headerValue(): string {
    const asset = this.marketService.selectedAsset();
    if (!asset) return '—';

    if (this.marketService.compareEnabled()) {
      const secondary = this.marketService.getSecondaryAsset();
      return secondary ? `${asset.name} vs ${secondary.name}` : asset.name;
    }

    if (asset.id !== 'austin-real-estate') {
      return asset.name;
    }

    const latest = this.marketService.latestPoint();
    if (!latest) return '—';

    return this.usdFormatter.format(latest.value);
  }

  hoverDateLabel(): string {
    const info = this.hoverInfo();
    if (!info) return '';
    return this.hoverDateFormatter.format(info.date);
  }

  hoverSeries(): HoverSeriesPoint[] {
    return this.hoverInfo()?.series ?? [];
  }

  formatHoverValue(value: number | null, mode: RenderMode): string {
    if (value == null || !Number.isFinite(value)) return '—';
    if (mode === 'price') {
      return this.hoverPriceFormatter.format(value);
    }
    return `${this.hoverPctFormatter.format(value)}%`;
  }

  formatDrawdown(value: number): string {
    if (!Number.isFinite(value)) return '—';
    return this.drawdownFormatter.format(value);
  }

  isRiskFeatureVisible(feature: RiskFeatureKey): boolean {
    if (!this.riskLensEnabled()) return false;
    if (feature === 'mean') return this.showMeanBands();
    if (feature === 'stress') return this.showStressMarkers();
    return true;
  }

  riskFeatureStatusLabel(feature: RiskFeatureKey): string {
    return this.isRiskFeatureVisible(feature) ? 'Visible' : 'Currently hidden';
  }

  private currentRenderMode(): RenderMode {
    return this.marketService.compareEnabled() ? 'pct' : 'price';
  }

  private installThemeObservers(): void {
    const host = this.chartContainer.nativeElement;
    const dash = host.closest('.dashboard-container') as HTMLElement | null;
    const target = dash ?? document.documentElement;

    this.themeObserver = new MutationObserver(() => {
      this.requestThemeRerender();
    });

    this.themeObserver.observe(target, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    this.mediaQueryList = window.matchMedia?.('(prefers-color-scheme: dark)') ?? undefined;
    if (this.mediaQueryList) {
      try {
        this.mediaQueryList.addEventListener('change', this.onSystemThemeChange);
      } catch {
        this.mediaQueryList.addListener?.(this.onSystemThemeChange);
      }
    }
  }

  private readonly onSystemThemeChange = () => {
    this.requestThemeRerender();
  };

  private requestThemeRerender(): void {
    if (this.queuedThemeRerender) return;
    this.queuedThemeRerender = true;

    requestAnimationFrame(() => {
      this.queuedThemeRerender = false;

      const lines = untracked(() => this.chartLines());
      const mode = untracked(() => this.currentRenderMode());

      if (!lines || lines.length === 0) return;

      this.render(lines, mode);
    });
  }

  private readThemeTokens(): ThemeTokens {
    const el = this.chartContainer.nativeElement;
    const cs = getComputedStyle(el);

    const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;

    const ink = get('--ink', '#000');
    const axis = get('--chart-axis', get('--border-mid', '#666'));
    const grid = get('--chart-grid', 'rgba(0,0,0,0.2)');
    const chartBg = get('--chart-bg', get('--inset', '#dedede'));
    const chartText = get('--chart-text', get('--text', '#111'));
    const chartMuted = get('--chart-muted', get('--muted', '#444'));
    const riskMean = get('--risk-mean-color', '#0f8d7a');
    const riskStress = get('--risk-stress-color', '#cf3f32');
    const riskDrawdown = get('--risk-drawdown-color', '#6b5dd3');

    return { ink, axis, grid, chartBg, chartText, chartMuted, riskMean, riskStress, riskDrawdown };
  }

  private render(lines: ChartLine[], mode: RenderMode): void {
    const host = this.chartContainer?.nativeElement;
    if (!host) return;
    this.hoverInfo.set(null);

    const tokens = this.readThemeTokens();

    const container = d3.select(host);
    container.selectAll('*').remove();

    if (!lines || lines.length === 0) return;

    const allPoints = lines.flatMap((line) => line.points);
    if (allPoints.length === 0) return;

    const validDates = allPoints
      .map((point) => point.date)
      .filter((date) => !Number.isNaN(date.getTime()));

    if (validDates.length === 0) return;

    const riskLensEnabled = this.riskLensEnabled();
    const showMeanBands = riskLensEnabled && this.showMeanBands();
    const showStressMarkers = riskLensEnabled && this.showStressMarkers();

    const meanBandLines = showMeanBands ? this.computeMeanBandLines(lines, tokens.riskMean) : [];
    const drawdownLines = riskLensEnabled
      ? lines.map((line, lineIndex) => this.computeDrawdownSeries(line, mode, lineIndex, tokens.riskDrawdown))
      : [];
    const stressMarkers = showStressMarkers
      ? lines.flatMap((line) => this.computeStressMarkers(line, mode, tokens.riskStress))
      : [];

    const numericValues = this.collectMainChartNumericValues(lines, meanBandLines);
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
    const panelGap = riskLensEnabled ? (isNarrow ? 16 : 18) : 0;

    let drawdownHeight = 0;
    let mainHeight = innerHeight;

    if (riskLensEnabled) {
      drawdownHeight = Math.max(56, Math.round(innerHeight * 0.28));
      mainHeight = Math.max(128, innerHeight - drawdownHeight - panelGap);

      if (mainHeight + drawdownHeight + panelGap > innerHeight) {
        drawdownHeight = Math.max(48, innerHeight - mainHeight - panelGap);
      }
    }

    const drawdownTop = mainHeight + panelGap;
    const hoverHeight = riskLensEnabled ? Math.max(mainHeight, drawdownTop + drawdownHeight) : mainHeight;

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

    const drawdownY = d3.scaleLinear().domain([-1, 0]).range([drawdownHeight, 0]);

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
    const mainPlot = g.append('g').attr('class', 'main-plot');

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

    const linePath = d3
      .line<{ date: Date; value: number | null }>()
      .defined((d) => d.value != null && Number.isFinite(d.value) && !Number.isNaN(d.date.getTime()))
      .x((d) => x(d.date))
      .y((d) => y(d.value as number))
      .curve(d3.curveMonotoneX);

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

    if (showStressMarkers && stressMarkers.length > 0) {
      const symbolPath = d3.symbol().type(d3.symbolTriangle).size(isNarrow ? 36 : 50);
      const markerGroup = mainPlot.append('g').attr('class', 'stress-markers');

      const marker = markerGroup
        .selectAll('path')
        .data(stressMarkers)
        .enter()
        .append('path')
        .attr('d', symbolPath)
        .attr('transform', (d) => `translate(${x(d.date)},${y(d.value)}) rotate(180)`)
        .attr('fill', (d) => d.color)
        .attr('stroke', tokens.chartBg)
        .attr('stroke-width', 2)
        .attr('opacity', 0.95);

      marker
        .append('title')
        .text(
          (d) =>
            `${d.assetName} | ${this.hoverDateFormatter.format(d.date)} | Return ${this.hoverPctFormatter.format(d.returnRatio * 100)}%`
        );
    }

    const yTickFormat = this.getYAxisFormatter(mode);
    const yAxis = mainPlot.append('g').call(
      d3
        .axisLeft(y)
        .ticks(yTicks)
        .tickSizeOuter(0)
        .tickFormat((value) => yTickFormat(Number(value)))
    );
    this.styleAxis(yAxis, tokens, isNarrow);

    if (riskLensEnabled) {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', drawdownTop - Math.max(1, panelGap / 2))
        .attr('y2', drawdownTop - Math.max(1, panelGap / 2))
        .attr('stroke', tokens.axis)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.8);

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

        const maxPoint = this.findMaxDrawdownPoint(drawdownLine.points);
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
          .tickFormat((value) => this.drawdownFormatter.format(Number(value)))
      );
      this.styleAxis(drawdownYAxis, tokens, isNarrow);

      const drawdownXAxis = drawdownPlot
        .append('g')
        .attr('transform', `translate(0,${drawdownHeight})`)
        .call(d3.axisBottom(x).ticks(xTicks).tickSizeOuter(0));
      this.styleAxis(drawdownXAxis, tokens, isNarrow);

      if (isNarrow) {
        drawdownXAxis.selectAll<SVGTextElement, unknown>('.tick text').attr('dy', '0.9em');
      }
    } else {
      const xAxis = g
        .append('g')
        .attr('transform', `translate(0,${mainHeight})`)
        .call(d3.axisBottom(x).ticks(xTicks).tickSizeOuter(0));
      this.styleAxis(xAxis, tokens, isNarrow);

      if (isNarrow) {
        xAxis.selectAll<SVGTextElement, unknown>('.tick text').attr('dy', '0.9em');
      }
    }

    this.installHoverBehavior({
      g,
      x,
      innerWidth,
      hoverHeight,
      lines,
      mode,
      isNarrow,
      tokens,
    });
  }

  private styleAxis(
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

  private collectMainChartNumericValues(lines: ChartLine[], meanBandLines: MeanBandLine[]): number[] {
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

  private computeDrawdownSeries(
    line: ChartLine,
    mode: RenderMode,
    lineIndex = 0,
    drawdownColor = '#6b5dd3'
  ): DrawdownLine {
    const points: DrawdownPoint[] = [];
    let runningPeak: number | null = null;

    for (const point of line.points) {
      if (!Number.isFinite(point.value) || point.value == null) {
        continue;
      }

      const valueForDrawdown = this.toRiskBaseValue(point.value, mode);
      if (valueForDrawdown == null) continue;

      if (runningPeak == null || valueForDrawdown > runningPeak) {
        runningPeak = valueForDrawdown;
      }

      if (!Number.isFinite(runningPeak) || runningPeak <= 0) continue;

      const drawdown = Math.max(-1, Math.min(0, valueForDrawdown / runningPeak - 1));
      points.push({ date: point.date, value: drawdown });
    }

    const maxDrawdown = points.length ? d3.min(points, (point) => point.value) ?? null : null;
    const strokeStyle: 'solid' | 'dashed' =
      this.marketService.compareEnabled() && lineIndex > 0 ? 'dashed' : 'solid';

    return {
      assetId: line.assetId,
      assetName: line.assetName,
      color: drawdownColor,
      strokeStyle,
      points,
      maxDrawdown,
    };
  }

  private findMaxDrawdownPoint(points: DrawdownPoint[]): DrawdownPoint | null {
    if (!points.length) return null;

    return points.reduce<DrawdownPoint | null>((worst, point) => {
      if (!worst) return point;
      return point.value < worst.value ? point : worst;
    }, null);
  }

  private computeStressMarkers(line: ChartLine, mode: RenderMode, markerColor: string): StressMarker[] {
    const stressCandidates: Array<{ date: Date; value: number; returnRatio: number }> = [];
    const negativeReturns: number[] = [];

    for (let i = 1; i < line.points.length; i += 1) {
      const previous = line.points[i - 1];
      const current = line.points[i];

      if (previous.value == null || current.value == null) continue;
      if (!Number.isFinite(previous.value) || !Number.isFinite(current.value)) continue;

      const priorBase = this.toRiskBaseValue(previous.value, mode);
      const currentBase = this.toRiskBaseValue(current.value, mode);
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
    const percentileThreshold =
      d3.quantileSorted(sortedNegativeReturns, 0.05) ?? this.getStressMinThreshold();
    const stressThreshold = Math.min(percentileThreshold, this.getStressMinThreshold());

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

  private computeMeanBandLines(lines: ChartLine[], bandColor: string): MeanBandLine[] {
    const sourceLines = this.marketService.compareEnabled() ? lines.slice(0, 1) : lines;
    const windowSize = this.getMeanBandWindow();
    const stdMultiplier = this.getMeanBandStdMultiplier();

    return sourceLines.map((line) => ({
      assetId: line.assetId,
      color: bandColor,
      points: this.computeMeanBandPoints(line.points, windowSize, stdMultiplier),
    }));
  }

  private computeMeanBandPoints(
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

  private toRiskBaseValue(value: number, mode: RenderMode): number | null {
    if (!Number.isFinite(value)) return null;

    if (mode === 'price') {
      return value > 0 ? value : null;
    }

    const indexValue = 100 + value;
    return indexValue > 0 ? indexValue : null;
  }

  private getStressMinThreshold(): number {
    return -0.03;
  }

  private getMeanBandWindow(): number {
    return 30;
  }

  private getMeanBandStdMultiplier(): number {
    return 2;
  }

  private installHoverBehavior(args: {
    g: d3.Selection<SVGGElement, unknown, null, undefined>;
    x: d3.ScaleTime<number, number>;
    innerWidth: number;
    hoverHeight: number;
    lines: ChartLine[];
    mode: RenderMode;
    isNarrow: boolean;
    tokens: ThemeTokens;
  }): void {
    const { g, x, innerWidth, hoverHeight, lines, mode, isNarrow, tokens } = args;

    if (isNarrow || !this.isDesktopHoverCapable()) {
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
    for (const line of lines) {
      const byTimestamp = new Map<number, number | null>();
      for (const point of line.points) {
        byTimestamp.set(point.date.getTime(), point.value);
      }
      valueByLineAndTimestamp.set(line.assetId, byTimestamp);
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
      }));

      this.hoverInfo.set({ date: hoverDate, mode, series });
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
      this.hoverInfo.set(null);
    });
  }

  private isDesktopHoverCapable(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }

    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  private getYAxisFormatter(mode: RenderMode): (value: number) => string {
    if (mode === 'price') {
      const fmt = d3.format('~s');
      return (value) => `$${fmt(value)}`;
    }

    const fmt = d3.format('.2~f');
    return (value) => `${fmt(value)}%`;
  }
}
