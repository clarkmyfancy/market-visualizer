import { Component, ElementRef, effect, inject, viewChild, AfterViewInit, HostListener } from '@angular/core';
import { MarketService } from '../../core/services/market.service';
import * as d3 from 'd3';

@Component({
  selector: 'app-market-chart',
  standalone: true,
  templateUrl: './market-chart.component.html',
  styleUrls: ['./market-chart.component.scss']
})
export class MarketChartComponent implements AfterViewInit {
  chartContainer = viewChild.required<ElementRef>('chartContainer');
  marketService = inject(MarketService);

  constructor() {
    // Redraw whenever the selected asset changes
    effect(() => {
      const asset = this.marketService.selectedAsset();
      if (asset) this.render(asset);
    });
  }

  @HostListener('window:resize')
  onResize() {
    const asset = this.marketService.selectedAsset();
    if (asset) this.render(asset);
  }

  ngAfterViewInit() {
    const asset = this.marketService.selectedAsset();
    if (asset) this.render(asset);
  }

  private render(asset: any) {
    const el = this.chartContainer().nativeElement;
    d3.select(el).selectAll('*').remove();

    const margin = { top: 20, right: 30, bottom: 30, left: 50 };
    const width = el.offsetWidth - margin.left - margin.right;
    const height = el.offsetHeight - margin.top - margin.bottom;

    const svg = d3.select(el)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X and Y Scales
    const xExtent = d3.extent(asset.history, (d: any) => d.date);
    const x = d3.scaleTime()
      .domain((xExtent[0] !== undefined && xExtent[1] !== undefined ? xExtent : [new Date(), new Date()]) as [Date, Date])
      .range([0, width]);

    const minVal = Number(d3.min(asset.history, (d: any) => d.value)) || 0;
    const maxVal = Number(d3.max(asset.history, (d: any) => d.value)) || 0;
    const y = d3.scaleLinear()
      .domain([minVal * 0.95, maxVal * 1.05])
      .range([height, 0]);

    // Draw Line
    const lineGenerator = d3.line<any>()
      .x(d => x(d.date))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    svg.append('path')
      .datum(asset.history)
      .attr('fill', 'none')
      .attr('stroke', asset.color)
      .attr('stroke-width', 3)
      .attr('d', lineGenerator);

    // Add Axes
    svg.append('g').attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x));
    svg.append('g').call(d3.axisLeft(y));
  }
}
