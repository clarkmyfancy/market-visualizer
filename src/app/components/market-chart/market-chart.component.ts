import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
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
  patternMomentum: string;
  patternMeanReversion: string;
  patternVolatility: string;
  patternTrend: string;
  patternPattern: string;
  patternHighlight: string;
};

type RenderMode = 'price' | 'pct';
type PatternSignalType = 'momentum' | 'meanReversion' | 'volatility' | 'trend' | 'pattern';
type PatternSensitivity = 'conservative' | 'normal' | 'sensitive';
type PatternSortMode = 'recency' | 'strength';
type PatternDirection = 'bullish' | 'bearish' | 'neutral';
type ExperimentMode = 'core' | 'signal-lens';

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

type AnalysisPoint = {
  date: Date;
  value: number;
  index: number;
};

type PatternSignal = {
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

type PatternFeedItem = PatternSignal & {
  hiddenOnChart: boolean;
};

type PatternTypeOption = {
  key: PatternSignalType;
  label: string;
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
  @Input() set experimentMode(mode: ExperimentMode | null | undefined) {
    const nextMode: ExperimentMode = mode === 'signal-lens' ? 'signal-lens' : 'core';
    this.currentExperimentMode.set(nextMode);
    this.patternsEnabled.set(nextMode === 'signal-lens');
    this.selectedPatternSignalId.set(null);
  }

  readonly marketService = inject(MarketService);
  readonly isSignalLensEnabled = computed(() => this.currentExperimentMode() === 'signal-lens');

  readonly ranges = computed(() => this.marketService.getVisibleRangeOptions());
  readonly compareAssetOptions = computed(() => this.marketService.getCompareAssetOptions());
  readonly chartLines = this.marketService.chartLines;
  readonly patternTypeOptions: PatternTypeOption[] = [
    { key: 'momentum', label: 'Momentum' },
    { key: 'meanReversion', label: 'Mean reversion' },
    { key: 'volatility', label: 'Volatility' },
    { key: 'trend', label: 'Trend / breakouts' },
    { key: 'pattern', label: 'Classic chart patterns' },
  ];

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

  private readonly viewReady = signal(false);
  private readonly currentExperimentMode = signal<ExperimentMode>('core');
  readonly hoverInfo = signal<HoverInfo | null>(null);
  readonly patternsEnabled = signal(false);
  readonly patternSensitivity = signal<PatternSensitivity>('normal');
  readonly patternSortMode = signal<PatternSortMode>('recency');
  readonly showOnlyStrongestPatternSignals = signal(false);
  readonly selectedPatternTypes = signal<PatternSignalType[]>([
    'momentum',
    'meanReversion',
    'volatility',
    'trend',
    'pattern',
  ]);
  readonly selectedPatternSignalId = signal<string | null>(null);

  readonly detectedPatternSignals = computed<PatternSignal[]>(() => {
    if (!this.isSignalLensEnabled() || !this.patternsEnabled()) return [];

    const mode = this.currentRenderMode();
    const primarySeries = this.chartLines()[0]?.points ?? [];
    const analysisSeries = this.toAnalysisSeries(primarySeries);

    if (analysisSeries.length < 6) return [];

    return this.detectPatternSignals(analysisSeries, mode, this.patternSensitivity());
  });

  readonly filteredPatternSignals = computed<PatternSignal[]>(() => {
    if (!this.isSignalLensEnabled() || !this.patternsEnabled()) return [];

    const selected = new Set(this.selectedPatternTypes());
    return this.detectedPatternSignals().filter((signal) => selected.has(signal.type));
  });

  readonly chartAnnotationSignals = computed<PatternSignal[]>(() => {
    const top = [...this.filteredPatternSignals()]
      .sort((a, b) => b.strength - a.strength || b.date.getTime() - a.date.getTime())
      .slice(0, 10);

    return top;
  });

  readonly patternFeedSignals = computed<PatternFeedItem[]>(() => {
    if (!this.isSignalLensEnabled() || !this.patternsEnabled()) return [];

    const sorted = this.sortPatternSignals(this.filteredPatternSignals(), this.patternSortMode());
    const chartIds = new Set(this.chartAnnotationSignals().map((signal) => signal.id));
    const feed = sorted.map((signal) => ({
      ...signal,
      hiddenOnChart: !chartIds.has(signal.id),
    }));

    if (this.showOnlyStrongestPatternSignals()) {
      return feed.filter((signal) => !signal.hiddenOnChart);
    }

    return feed;
  });

  readonly hiddenPatternSignalCount = computed<number>(() => {
    if (!this.isSignalLensEnabled() || !this.patternsEnabled()) return 0;
    if (this.showOnlyStrongestPatternSignals()) return 0;

    return this.filteredPatternSignals().length - this.chartAnnotationSignals().length;
  });
  private resizeObserver?: ResizeObserver;

  private themeObserver?: MutationObserver;
  private mediaQueryList?: MediaQueryList;
  private queuedThemeRerender = false;

  private readonly renderEffect = effect(() => {
    if (!this.viewReady()) return;

    const lines = this.chartLines();
    const mode = this.currentRenderMode();
    const patternsEnabled = this.patternsEnabled();
    const experimentMode = this.currentExperimentMode();
    void experimentMode;
    const selectedTypes = this.selectedPatternTypes();
    const sensitivity = this.patternSensitivity();
    const sortMode = this.patternSortMode();
    const strongestOnly = this.showOnlyStrongestPatternSignals();
    const selectedSignal = this.selectedPatternSignalId();
    void patternsEnabled;
    void selectedTypes;
    void sensitivity;
    void sortMode;
    void strongestOnly;
    void selectedSignal;

    this.render(lines, mode);
  }, { allowSignalWrites: true });

  private readonly selectedSignalGuardEffect = effect(() => {
    const selectedId = this.selectedPatternSignalId();
    if (!selectedId) return;

    const feedIds = new Set(this.patternFeedSignals().map((signal) => signal.id));
    if (!feedIds.has(selectedId)) {
      this.selectedPatternSignalId.set(null);
    }
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

  isPatternTypeSelected(type: PatternSignalType): boolean {
    return this.selectedPatternTypes().includes(type);
  }

  togglePatternType(type: PatternSignalType): void {
    const selected = this.selectedPatternTypes();
    if (selected.includes(type)) {
      this.selectedPatternTypes.set(selected.filter((entry) => entry !== type));
      return;
    }

    this.selectedPatternTypes.set([...selected, type]);
  }

  setPatternSensitivity(value: string): void {
    const valid: PatternSensitivity[] = ['conservative', 'normal', 'sensitive'];
    if (!valid.includes(value as PatternSensitivity)) return;
    this.patternSensitivity.set(value as PatternSensitivity);
  }

  setPatternSortMode(value: string): void {
    const valid: PatternSortMode[] = ['recency', 'strength'];
    if (!valid.includes(value as PatternSortMode)) return;
    this.patternSortMode.set(value as PatternSortMode);
  }

  setShowOnlyStrongestPatternSignals(enabled: boolean): void {
    this.showOnlyStrongestPatternSignals.set(enabled);
  }

  focusPatternSignal(signalId: string): void {
    this.selectedPatternSignalId.set(signalId);
    this.chartContainer.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  formatPatternSignalDate(signal: PatternSignal): string {
    if (signal.startDate && signal.endDate) {
      return `${this.hoverDateFormatter.format(signal.startDate)} - ${this.hoverDateFormatter.format(signal.endDate)}`;
    }

    return this.hoverDateFormatter.format(signal.date);
  }

  formatPatternSignalStrength(signal: PatternSignal): string {
    const score = Math.round(signal.strength);
    if (score >= 75) return `${score}/100 (High)`;
    if (score >= 45) return `${score}/100 (Medium)`;
    return `${score}/100 (Low)`;
  }

  formatPatternDirection(signal: PatternSignal): string {
    if (signal.direction === 'bullish') return 'Bullish';
    if (signal.direction === 'bearish') return 'Bearish';
    return 'Neutral';
  }

  formatPatternType(signalType: PatternSignalType): string {
    const option = this.patternTypeOptions.find((entry) => entry.key === signalType);
    return option?.label ?? signalType;
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
    const patternMomentum = get('--pattern-momentum-color', '#1e63d8');
    const patternMeanReversion = get('--pattern-mean-reversion-color', '#0f8d7a');
    const patternVolatility = get('--pattern-volatility-color', '#c86a06');
    const patternTrend = get('--pattern-trend-color', '#8a3fd0');
    const patternPattern = get('--pattern-pattern-color', '#6f6f6f');
    const patternHighlight = get('--pattern-highlight-color', '#111111');

    return {
      ink,
      axis,
      grid,
      chartBg,
      chartText,
      chartMuted,
      patternMomentum,
      patternMeanReversion,
      patternVolatility,
      patternTrend,
      patternPattern,
      patternHighlight,
    };
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

    const patternSignals = this.isSignalLensEnabled() ? this.chartAnnotationSignals() : [];
    const selectedPatternSignalId = this.selectedPatternSignalId();

    const numericValues = allPoints
      .map((point) => point.value)
      .filter((value): value is number => value != null && Number.isFinite(value));

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
      .range([innerHeight, 0])
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

    g.append('g')
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

    g.select('.grid .domain').remove();

    const linePath = d3
      .line<{ date: Date; value: number | null }>()
      .defined((d) => d.value != null && Number.isFinite(d.value) && !Number.isNaN(d.date.getTime()))
      .x((d) => x(d.date))
      .y((d) => y(d.value as number))
      .curve(d3.curveMonotoneX);

    for (const line of lines) {
      g.append('path')
        .datum(line.points)
        .attr('fill', 'none')
        .attr('stroke', line.color)
        .attr('stroke-width', 2.5)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('stroke-dasharray', line.strokeStyle === 'dashed' ? '8,5' : null)
        .attr('d', linePath);
    }

    if (patternSignals.length > 0) {
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
          .attr('fill', (signal) => this.getPatternColor(signal.type, tokens))
          .attr('fill-opacity', (signal) => signal.id === selectedPatternSignalId ? 0.22 : 0.13)
          .attr('stroke', (signal) => this.getPatternColor(signal.type, tokens))
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
        .attr('fill', (signal) => this.getPatternColor(signal.type, tokens))
        .attr('stroke', tokens.chartBg)
        .attr('stroke-width', (signal) => signal.id === selectedPatternSignalId ? 2.7 : 2)
        .attr('opacity', (signal) => signal.id === selectedPatternSignalId ? 1 : 0.9)
        .append('title')
        .text(
          (signal) =>
            `${signal.name} | ${this.formatPatternSignalDate(signal)} | Strength ${Math.round(signal.strength)}`
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
          signal.id === selectedPatternSignalId ? tokens.patternHighlight : this.getPatternColor(signal.type, tokens)
        )
        .attr('font-size', isNarrow ? 8.5 : 9.5)
        .attr('font-weight', 900)
        .text((signal) => signal.chartAnnotation.label);
    }

    const xAxis = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(xTicks).tickSizeOuter(0));

    const yTickFormat = this.getYAxisFormatter(mode);
    const yAxis = g.append('g').call(
      d3
        .axisLeft(y)
        .ticks(yTicks)
        .tickSizeOuter(0)
        .tickFormat((value) => yTickFormat(Number(value)))
    );

    for (const axisSel of [xAxis, yAxis]) {
      axisSel.selectAll('.domain').attr('stroke', tokens.axis).attr('stroke-width', 2);
      axisSel.selectAll('.tick line').attr('stroke', tokens.axis).attr('stroke-width', 2);

      axisSel
        .selectAll('.tick text')
        .attr('fill', tokens.chartText)
        .attr('font-size', isNarrow ? 10 : 11)
        .attr('font-weight', 900);
    }

    if (isNarrow) {
      xAxis.selectAll<SVGTextElement, unknown>('.tick text').attr('dy', '0.9em');
    }

    this.installHoverBehavior({
      g,
      x,
      innerWidth,
      innerHeight,
      lines,
      mode,
      isNarrow,
      tokens,
    });
  }

  private getPatternColor(signalType: PatternSignalType, tokens: ThemeTokens): string {
    if (signalType === 'momentum') return tokens.patternMomentum;
    if (signalType === 'meanReversion') return tokens.patternMeanReversion;
    if (signalType === 'volatility') return tokens.patternVolatility;
    if (signalType === 'trend') return tokens.patternTrend;
    return tokens.patternPattern;
  }

  private sortPatternSignals(signals: PatternSignal[], mode: PatternSortMode): PatternSignal[] {
    if (mode === 'strength') {
      return [...signals].sort(
        (a, b) =>
          b.strength - a.strength ||
          this.signalTimestamp(b) - this.signalTimestamp(a)
      );
    }

    return [...signals].sort(
      (a, b) =>
        this.signalTimestamp(b) - this.signalTimestamp(a) ||
        b.strength - a.strength
    );
  }

  private signalTimestamp(signal: PatternSignal): number {
    return (signal.endDate ?? signal.date).getTime();
  }

  private toAnalysisSeries(points: Array<{ date: Date; value: number | null }>): AnalysisPoint[] {
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

  private detectPatternSignals(
    points: AnalysisPoint[],
    mode: RenderMode,
    sensitivity: PatternSensitivity
  ): PatternSignal[] {
    void mode;

    return [
      ...this.detectMovingAverageCrossSignals(points, sensitivity),
      ...this.detectRsiSignals(points, sensitivity),
      ...this.detectBollingerSignals(points, sensitivity),
      ...this.detectRangeBreakoutSignals(points, sensitivity),
      ...this.detectVolatilitySpikeSignals(points, sensitivity),
    ];
  }

  private detectMovingAverageCrossSignals(
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

    const shortMa = this.simpleMovingAverageSeries(values, shortLength);
    const longMa = this.simpleMovingAverageSeries(values, longLength);
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

      const persists = this.crossPersists(shortMa, longMa, i, base.confirmation, bullishCross ? 'above' : 'below');
      if (!persists) continue;

      const spread = Math.abs(currDiff);
      const valueScale = Math.max(1e-6, Math.abs(points[i].value));
      let strength = this.clampStrength((spread / valueScale) * 2500 + (base.confirmation > 1 ? 10 : 0));
      if (adjustedForDataLimits) {
        strength = this.clampStrength(strength - 18);
      }

      const direction: PatternDirection = bullishCross ? 'bullish' : 'bearish';
      const signalDate = points[i].date;
      const crossoverType = bullishCross ? 'Golden cross' : 'Death cross';

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
        explanations: [
          'Systematic strategies and trend-followers use moving averages, causing clustered buying/selling when a crossover happens.',
          'Moving averages summarize recent consensus; crossing often reflects a real regime shift in momentum.',
          'Risk managers and allocators adjust exposure when longer-term trends change, reinforcing the move.',
        ],
        interpretation: [
          'This signal is often associated with trend transitions rather than immediate reversals.',
          'Historically it tends to coincide with persistent momentum when the spread keeps widening after the cross.',
        ],
        chartAnnotation: {
          date: signalDate,
          value: points[i].value,
          label: 'MA crossover',
        },
      });
    }

    return signals;
  }

  private crossPersists(
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

  private detectRsiSignals(points: AnalysisPoint[], sensitivity: PatternSensitivity): PatternSignal[] {
    if (points.length < 18) return [];

    const values = points.map((point) => point.value);
    const rsi = this.computeRsiSeries(values, 14);
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
      const strength = this.clampStrength(30 + (distance / Math.max(1, threshold)) * 200);
      const signalDate = points[i].date;

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
        explanations: [
          'Sharp moves exhaust marginal buyers/sellers; mean reversion can occur as participants take profits or cover.',
          'Behavioral overreaction and recency bias can push price too far relative to recent pace.',
          'Short-term liquidity imbalances (panic selling or forced selling) can drive RSI extremes.',
        ],
        interpretation: [
          'This is often associated with stretched conditions, not a guaranteed reversal.',
          'Historically it tends to coincide with elevated two-way volatility around the extreme zone.',
        ],
        chartAnnotation: {
          date: signalDate,
          value: points[i].value,
          label: oversold ? 'RSI OS' : 'RSI OB',
        },
      });
    }

    return signals;
  }

  private detectBollingerSignals(
    points: AnalysisPoint[],
    sensitivity: PatternSensitivity
  ): PatternSignal[] {
    if (points.length < 24) return [];

    const values = points.map((point) => point.value);
    const ma = this.simpleMovingAverageSeries(values, 20);
    const std = this.rollingStdSeries(values, 20);
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

      const percentile = this.percentileRank(history, currentWidth);
      const prevPercentile = this.percentileRank(history, prevWidth);

      const isSqueeze = percentile < lowThreshold && prevPercentile >= lowThreshold;
      const widthJumpRatio = prevWidth > 0 ? currentWidth / prevWidth : 1;
      const isExpansion =
        percentile > highThreshold &&
        (prevPercentile <= highThreshold || widthJumpRatio > 1.17);

      if (!isSqueeze && !isExpansion) continue;

      const direction: PatternDirection = 'neutral';
      const signalDate = points[i].date;
      const percentilePct = percentile * 100;
      const strength = isSqueeze
        ? this.clampStrength(35 + ((lowThreshold - percentile) / Math.max(0.02, lowThreshold)) * 100)
        : this.clampStrength(
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
        explanations: [
          'Markets alternate between consolidation (low volatility) and repricing (breakouts) as information arrives and positions reset.',
          'Low volatility often reflects temporary agreement or lack of catalysts; once triggered, stops and breakout orders can create expansion.',
          'Option hedging and volatility targeting can amplify transitions from calm to volatile conditions.',
        ],
        interpretation: [
          'Squeezes are often associated with compressed risk that can resolve with larger directional moves.',
          'Expansions tend to coincide with repricing phases, but direction still depends on broader context.',
        ],
        chartAnnotation: {
          date: signalDate,
          value: points[i].value,
          label: isSqueeze ? 'BB squeeze' : 'BB expand',
        },
      });
    }

    return signals;
  }

  private detectRangeBreakoutSignals(
    points: AnalysisPoint[],
    sensitivity: PatternSensitivity
  ): PatternSignal[] {
    if (points.length < 16) return [];

    const lookbackBySensitivity = { conservative: 50, normal: 20, sensitive: 10 };
    const breakoutPctBySensitivity = { conservative: 0.01, normal: 0.007, sensitive: 0.005 };
    const lookback = Math.min(points.length - 2, lookbackBySensitivity[sensitivity]);
    if (lookback < 8) return [];

    const returns = this.computeStepReturns(points.map((point) => point.value));
    const rollingVol = this.rollingStdSeries(returns.map((value) => value ?? 0), 14);
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
      const strength = this.clampStrength(40 + moveRatio * 26);
      const signalDate = points[i].date;

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
        explanations: [
          'Support/resistance zones form because traders anchor to prior highs/lows and place orders there.',
          'Breakouts trigger stop orders and momentum entries, creating one-directional flows.',
          'A break often signals new information or a shift in supply/demand balance.',
        ],
        interpretation: [
          'Range breaks are often associated with regime transitions, especially after prolonged consolidation.',
          'Historically this can coincide with follow-through when price remains outside the prior range.',
        ],
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

  private detectVolatilitySpikeSignals(
    points: AnalysisPoint[],
    sensitivity: PatternSensitivity
  ): PatternSignal[] {
    if (points.length < 16) return [];

    const returns = this.computeStepReturns(points.map((point) => point.value));
    const absReturns = returns.map((value) => Math.abs(value ?? 0));
    const rollingVol = this.rollingStdSeries(absReturns, 20);
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

      const percentile = this.percentileRank(volHistory, currentVol);
      const prevPercentile = this.percentileRank(volHistory, prevVol);
      if (!(percentile > thresholdBySensitivity && prevPercentile <= thresholdBySensitivity)) continue;

      const jumpRatio = prevVol > 1e-6 ? currentVol / prevVol : 1;
      const strength = this.clampStrength(
        35 +
          ((percentile - thresholdBySensitivity) / Math.max(0.02, 1 - thresholdBySensitivity)) * 90 +
          Math.max(0, (jumpRatio - 1) * 30)
      );
      const signalDate = points[i].date;

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
        explanations: [
          'Deleveraging and risk-limit breaches can force selling, increasing realized volatility.',
          'Uncertainty shocks widen spreads and reduce liquidity, magnifying moves.',
          'Volatility-targeting funds adjust exposure mechanically, which can reinforce spikes.',
        ],
        interpretation: [
          'Volatility spikes often coincide with unstable liquidity and larger intraperiod swings.',
          'Historically these regimes can persist briefly before normalizing, so position sizing matters more than direction calls.',
        ],
        chartAnnotation: {
          date: signalDate,
          value: points[i].value,
          label: 'Vol spike',
        },
      });
    }

    return signals;
  }

  private computeStepReturns(values: number[]): Array<number | null> {
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

  private simpleMovingAverageSeries(values: number[], window: number): Array<number | null> {
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

  private rollingStdSeries(values: number[], window: number): Array<number | null> {
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

  private computeRsiSeries(values: number[], length: number): Array<number | null> {
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
    rsi[length] = this.computeRsiFromAverages(avgGain, avgLoss);

    for (let i = length + 1; i < values.length; i += 1) {
      const delta = values[i] - values[i - 1];
      const gain = Math.max(0, delta);
      const loss = Math.max(0, -delta);

      avgGain = ((avgGain * (length - 1)) + gain) / length;
      avgLoss = ((avgLoss * (length - 1)) + loss) / length;
      rsi[i] = this.computeRsiFromAverages(avgGain, avgLoss);
    }

    return rsi;
  }

  private computeRsiFromAverages(avgGain: number, avgLoss: number): number {
    if (avgLoss === 0 && avgGain === 0) return 50;
    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private percentileRank(values: number[], current: number): number {
    if (!values.length) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1) return 1;

    const idx = d3.bisectRight(sorted, current) - 1;
    return Math.max(0, Math.min(1, idx / (sorted.length - 1)));
  }

  private clampStrength(rawScore: number): number {
    return Math.max(0, Math.min(100, rawScore));
  }

  private installHoverBehavior(args: {
    g: d3.Selection<SVGGElement, unknown, null, undefined>;
    x: d3.ScaleTime<number, number>;
    innerWidth: number;
    innerHeight: number;
    lines: ChartLine[];
    mode: RenderMode;
    isNarrow: boolean;
    tokens: ThemeTokens;
  }): void {
    const { g, x, innerWidth, innerHeight, lines, mode, isNarrow, tokens } = args;

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
      .attr('y2', innerHeight)
      .attr('stroke', tokens.axis)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,4')
      .style('display', 'none');

    const interactionZone = g
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', innerHeight)
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
