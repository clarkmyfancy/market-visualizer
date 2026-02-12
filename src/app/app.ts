import { Component, ElementRef, HostListener, viewChild, AfterViewInit } from '@angular/core';
import * as d3 from 'd3';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <div style="padding: 20px; background: #121212; min-height: 100vh; color: white;">
      <h1>Market Visualizer</h1>
      <div #container style="width: 100%; height: 50vh; background: #1a1a1a; border-radius: 12px;"></div>
    </div>
  `
})
export class App implements AfterViewInit {
  container = viewChild.required<ElementRef>('container');

  @HostListener('window:resize')
  onResize() { this.render(); }

  ngAfterViewInit() { this.render(); }

  render() {
    const el = this.container().nativeElement;
    d3.select(el).selectAll('*').remove();
    const svg = d3.select(el).append('svg')
      .attr('width', el.offsetWidth)
      .attr('height', el.offsetHeight);

    svg.append('text')
      .attr('x', el.offsetWidth / 2)
      .attr('y', el.offsetHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#00aeef')
      .text('D3 ACTIVE - RESPONSIVE');
  }
}
