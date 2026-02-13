import {
  AfterViewInit,
  Component,
  DestroyRef,
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
import { DataPoint } from '../../shared/models/market.model';

type ThemeTokens = {
  text: string;
  muted: string;
  borderDark: string;
  borderMid: string;
  panel: string;
  chartBg: string;
  grid: string;
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
  private readonly destroyRef = inject(DestroyRef);

  private readonly viewReady = signal(false);
  private resizeObserver?: ResizeObserver;

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
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private readThemeTokens(): ThemeTokens {
    const el = this.chartContainer.nativeElement;

    // Variables are defined on the dashboard container; computed style will resolve them here.
    const cs = getComputedStyle(el);

    const get = (name: string, fallback: string) => {
      const v = cs.getPropertyValue(name).trim();
      return v || fallback;
    };

    const borderDark = get('--border-dark', '#000');
    const borderMid = get('--border-mid', '#666');
    const text = get('--text', '#111');
    const muted = get('--muted', '#444');
    const panel = get('--panel', '#f3f3f3');

    // Optional chart-specific vars (set in chart SCSS below)
    const chartBg = get('--chart-bg', panel);
    const grid = get('--chart-grid', borderMid);

    return { text, muted, borderDark, borderMid, panel, chartBg, grid };
  }

  private render(series: DataPoint[], accentColor: string): void {
    const host = this.chartContainer?.nativeElement;
    if (!host) return;

    const tokens = this.readThemeTokens();

    const container = d3.select(host);
    container.selectAll('*').remove();

    if (!series || series.length === 0) return;

    const rect = host.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || 0));
    const height = Math.max(240, Math.floor(rect.height || 0));

    const margin = { top: 16, right: 24, bottom: 28, left: 56 };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);

    const xExtent = d3.extent(series, (d) => d.date);
    if (!xExtent[0] || !xExtent[1]) return;

    const yMin = d3.min(series, (d) => d.value);
    const yMax = d3.max(series, (d) => d.value);
    if (yMin == null || yMax == null) return;

    const range = yMax - yMin;
    const pad = range === 0 ? Math.max(1, Math.abs(yMax) * 0.01) : range * 0.05;

    const x = d3.scaleTime().domain(xExtent as [Date, Date]).range([0, innerWidth]);
    const y = d3
      .scaleLinear()
      .domain([yMin - pad, yMax + pad])
      .range([innerHeight, 0])
      .nice();

    const svg = container
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);

    // Background inside SVG (so it matches theme even if container is transparent)
    svg
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height)
      .attr('fill', tokens.chartBg);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Grid (theme-driven)
    g.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(6).tickSize(-innerWidth).tickFormat(() => ''))
      .selectAll('line')
      .attr('stroke', tokens.grid);

    g.select('.grid .domain').remove();

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
      .attr('stroke-width', 2)
      .attr('d', line);

    const xAxis = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));

    const fmt = d3.format('~s');
    const yAxis = g.append('g').call(
      d3
        .axisLeft(y)
        .ticks(6)
        .tickSizeOuter(0)
        .tickFormat((d) => `$${fmt(Number(d))}`)
    );

    // Theme axis styling (don’t rely on global CSS)
    for (const axis of [xAxis, yAxis]) {
      axis.selectAll('.domain').attr('stroke', tokens.borderDark);
      axis.selectAll('.tick line').attr('stroke', tokens.borderMid);
      axis.selectAll('.tick text').attr('fill', tokens.muted).attr('font-size', 11);
    }
  }
}
