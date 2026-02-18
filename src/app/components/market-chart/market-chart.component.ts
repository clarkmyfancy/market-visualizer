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
  NormalizeMode,
} from '../../core/services/market.service';
import { TimeRange } from '../../shared/models/market.model';

type ThemeTokens = {
  ink: string;
  axis: string;
  grid: string;
  chartBg: string;
  chartText: string;
  chartMuted: string;
};

type RenderMode = 'price' | NormalizeMode;

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

  private readonly viewReady = signal(false);
  private resizeObserver?: ResizeObserver;

  private themeObserver?: MutationObserver;
  private mediaQueryList?: MediaQueryList;
  private queuedThemeRerender = false;

  private readonly renderEffect = effect(() => {
    if (!this.viewReady()) return;

    const lines = this.chartLines();
    const mode = this.currentRenderMode();
    this.render(lines, mode);
  });

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

  setNormalizeMode(mode: string): void {
    if (mode !== 'index' && mode !== 'pct') return;
    this.marketService.setNormalizeMode(mode);
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

  private currentRenderMode(): RenderMode {
    return this.marketService.compareEnabled() ? this.marketService.normalizeMode() : 'price';
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

    return { ink, axis, grid, chartBg, chartText, chartMuted };
  }

  private render(lines: ChartLine[], mode: RenderMode): void {
    const host = this.chartContainer?.nativeElement;
    if (!host) return;

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
  }

  private getYAxisFormatter(mode: RenderMode): (value: number) => string {
    if (mode === 'price') {
      const fmt = d3.format('~s');
      return (value) => `$${fmt(value)}`;
    }

    if (mode === 'pct') {
      const fmt = d3.format('.2~f');
      return (value) => `${fmt(value)}%`;
    }

    const fmt = d3.format('.2~f');
    return (value) => fmt(value);
  }
}
