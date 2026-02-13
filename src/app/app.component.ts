import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';

import { MarketService } from './core/services/market.service';
import { MarketChartComponent } from './components/market-chart/market-chart.component';
import { MarketAsset } from './shared/models/market.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MarketChartComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  readonly marketService = inject(MarketService);
  assets: MarketAsset[] = [];

  ngOnInit(): void {
    this.assets = this.marketService.getAssets();

    if (this.assets.length > 0) {
      this.selectAsset(this.assets[0]);
    }
  }

  selectAsset(asset: MarketAsset): void {
    this.marketService.selectAsset(asset);
  }
}
