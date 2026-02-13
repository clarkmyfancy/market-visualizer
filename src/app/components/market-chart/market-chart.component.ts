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

  // ✅ Create effect in injection context (field initializer)
  private readonly renderEffect = effect(
    () => {
      // Don’t render until ViewChild exists
      if (!this.viewReady()) return;

      const series = this.marketService.series();
      const color = this.marketService.selectedAsset()?.color ?? '#3b82f6';
      this.render(series, color);
    }
  );

  ngAfterViewInit(): void {
    this.viewReady.set(true);

    this.resizeObserver = new ResizeObserver(() => {
      const series = untracked(() => this.marketService.series());
      const color = untracked(() => this.marketService.selectedAsset()?.color ?? '#3b82f6');
      this.render(series, color);
    });

    this.resizeObserver.observe(this.chartContainer.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private render(series: DataPoint[], color: string): void {
    const host = this.chartContainer?.nativeElement;
    if (!host) return;

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

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    g.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(6).tickSize(-innerWidth).tickFormat(() => ''))
      .selectAll('line')
      .attr('stroke', '#222');

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
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('d', line);

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));

    const fmt = d3.format('~s');
    g.append('g').call(
      d3
        .axisLeft(y)
        .ticks(6)
        .tickSizeOuter(0)
        .tickFormat((d) => `$${fmt(Number(d))}`)
    );
  }
}
