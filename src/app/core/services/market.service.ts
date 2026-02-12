import { Injectable, signal } from '@angular/core';
import { MarketAsset, DataPoint } from '../../shared/models/market.model';

@Injectable({ providedIn: 'root' })
export class MarketService {
  // The global state for the selected asset
  selectedAsset = signal<MarketAsset | null>(null);

  // Generates 30 days of mock data for testing
  private generateMockData(startValue: number, volatility: number): DataPoint[] {
    return Array.from({ length: 30 }).map((_, i) => ({
      date: new Date(new Date().setDate(new Date().getDate() - (30 - i))),
      value: startValue + (Math.random() - 0.5) * volatility * i
    }));
  }

  loadAssets(): MarketAsset[] {
    return [
      {
        id: 'btc-1',
        name: 'Bitcoin',
        category: 'crypto',
        color: '#F7931A',
        history: this.generateMockData(45000, 2000)
      },
      {
        id: 'atx-housing',
        name: 'Austin Real Estate (Avg)',
        category: 'real-estate',
        color: '#00AEEF',
        history: this.generateMockData(550000, 5000)
      }
    ];
  }
}
