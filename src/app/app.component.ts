import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarketService } from './core/services/market.service';
import { MarketChartComponent } from './components/market-chart/market-chart.component';
import { MarketAsset } from './shared/models/market.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MarketChartComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  // Inject the core service to handle global market state
  marketService = inject(MarketService);
  assets: MarketAsset[] = [];

  ngOnInit(): void {
    // Load mock data for Crypto and Austin Real Estate
    this.assets = this.marketService.loadAssets();

    // Set default view on initialization
    if (this.assets.length > 0) {
      this.selectAsset(this.assets[0]);
    }
  }

  /**
   * Updates the global signal in the MarketService.
   * This triggers the reactive D3 redraw in the child component.
   */
  selectAsset(asset: MarketAsset): void {
    this.marketService.selectedAsset.set(asset);
  }
}
