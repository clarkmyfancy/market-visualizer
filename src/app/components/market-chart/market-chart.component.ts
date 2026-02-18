import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import * as d3 from 'd3';

import { MarketService } from '../../core/services/market.service';
import { DataPoint, TimeRange } from '../../shared/models/market.model';

type ThemeTokens = {
  ink: string;
  axis: string;
  grid: string;
  chartBg: string;
  chartText: string;
  chartMuted: string;
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

  readonly ranges = this.marketService.getRangeOptions();

  private readonly viewReady = signal(false);
  private resizeObserver?: ResizeObserver;

  // NEW: re-render chart when theme tokens change (theme toggle / system theme changes)
  private themeObserver?: MutationObserver;
  private mediaQueryList?: MediaQueryList;
  private queuedThemeRerender = false;

  private readonly renderEffect = effect(() => {
    if (!this.viewReady()) return;

    const series = this.marketService.series();
    const accent = this.marketService.selectedAsset()?.color ?? '#3b82f6';
    this.render(series, accent);
  });

  ngAfterViewInit(): void {
    this.viewReady.set(true);

    this.resizeObserver = new ResizeObserver(() => {
      const series = untracked(() => this.marketService.series());
      const accent = untracked(() => this.marketService.selectedAsset()?.color ?? '#3b82f6');
      this.render(series, accent);
    });

    this.resizeObserver.observe(this.chartContainer.nativeElement);

    // Theme changes may happen without series changing (so renderEffect won't run).
    // Watch for class/style changes up the tree and rerender to pick up new CSS variables.
    this.installThemeObservers();

    // Initial paint after observers installed
    this.requestThemeRerender();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();

    if (this.mediaQueryList) {
      // removeEventListener is supported in modern browsers; fallback handled defensively
      try {
        this.mediaQueryList.removeEventListener('change', this.onSystemThemeChange);
      } catch {
        this.mediaQueryList.removeListener?.(this.onSystemThemeChange);
      }
    }
  }

  setRange(r: TimeRange): void {
    this.marketService.setRange(r);
  }

  private installThemeObservers(): void {
    const host = this.chartContainer.nativeElement;

    // Watch the nearest dashboard container (where theme class/tokens live).
    const dash = host.closest('.dashboard-container') as HTMLElement | null;

    // Fallback: observe documentElement if container isn't found.
    const target = dash ?? document.documentElement;

    this.themeObserver = new MutationObserver(() => {
      this.requestThemeRerender();
    });

    this.themeObserver.observe(target, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    // Also rerender on OS-level theme changes (if your app applies theme automatically).
    // Even if you don't, this is harmless.
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

    // Coalesce multiple mutations into one rerender
    requestAnimationFrame(() => {
      this.queuedThemeRerender = false;

      const series = untracked(() => this.marketService.series());
      const accent = untracked(() => this.marketService.selectedAsset()?.color ?? '#3b82f6');

      // If no data yet, nothing to rerender.
      if (!series || series.length === 0) return;

      this.render(series, accent);
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

  private render(series: DataPoint[], accentColor: string): void {
    const host = this.chartContainer?.nativeElement;
    if (!host) return;

    const tokens = this.readThemeTokens();

    const container = d3.select(host);
    container.selectAll('*').remove();

    if (!series || series.length === 0) return;

    const rect = host.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || 0));
    const height = Math.max(240, Math.floor(rect.height || 0));

    const isNarrow = width < 520;

    const margin = {
      top: 16,
      right: isNarrow ? 14 : 24,
      bottom: isNarrow ? 26 : 28,
      left: isNarrow ? 50 : 56,
    };

    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);

    const xExtent = d3.extent(series, (d) => d.date);
    if (!xExtent[0] || !xExtent[1]) return;

    const yMin = d3.min(series, (d) => d.value);
    const yMax = d3.max(series, (d) => d.value);
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

    // Chart background “paper” from theme tokens
    svg.append('rect').attr('width', width).attr('height', height).attr('fill', tokens.chartBg);

    // Ink frame
    svg.append('rect')
      .attr('x', 1.5)
      .attr('y', 1.5)
      .attr('width', Math.max(0, width - 3))
      .attr('height', Math.max(0, height - 3))
      .attr('fill', 'none')
      .attr('stroke', tokens.ink)
      .attr('stroke-width', 3);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Grid (dotted)
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

    // Series line
    const line = d3
      .line<DataPoint>()
      .defined((d) => Number.isFinite(d.value) && !Number.isNaN(d.date.getTime()))
      .x((d) => x(d.date))
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', accentColor)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('d', line);

    const xAxis = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(xTicks).tickSizeOuter(0));

    const fmt = d3.format('~s');
    const yAxis = g.append('g').call(
      d3
        .axisLeft(y)
        .ticks(yTicks)
        .tickSizeOuter(0)
        .tickFormat((d) => `$${fmt(Number(d))}`)
    );

    // Axis styling: high-contrast
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
}
