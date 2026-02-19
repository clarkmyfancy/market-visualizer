import { Injectable, computed, signal } from '@angular/core';

import { DataPoint, MarketAsset, TimeRange } from '../../shared/models/market.model';

@Injectable({ providedIn: 'root' })
export class MarketStateStore {
  readonly selectedAsset = signal<MarketAsset | null>(null);
  readonly series = signal<DataPoint[]>([]);
  readonly latestPoint = computed<DataPoint | null>(() => {
    const points = this.series();
    return points.length > 0 ? points[points.length - 1] : null;
  });

  readonly range = signal<TimeRange>('month');
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly austinMetricLabel = signal<string>('Median Sale Price');

  readonly compareEnabled = signal<boolean>(false);
  readonly secondaryAssetId = signal<string | null>(null);

  readonly fullSeriesByAsset = signal<Map<string, DataPoint[]>>(new Map());
  readonly fullSeriesLoadingAssets = signal<Set<string>>(new Set());
}
