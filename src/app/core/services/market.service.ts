import { Injectable, signal } from '@angular/core';
import { MarketAsset } from '../../shared/models/market.model';

@Injectable({ providedIn: 'root' })
export class MarketService {
  // The 'Signal' that the whole app will watch
  activeAsset = signal<MarketAsset | null>(null);

  loadInitialData() {
    this.activeAsset.set({
      id: 'atx-housing',
      name: 'Austin Real Estate Average',
      category: 'real-estate',
      color: '#00aeef',
      history: [
        { date: new Date('2026-01-01'), value: 550000 },
        { date: new Date('2026-02-01'), value: 555000 }
      ]
    });
  }
}
