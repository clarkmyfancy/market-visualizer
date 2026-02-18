import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { DataPoint, MarketAsset, TimeRange } from '../../shared/models/market.model';
import { AustinHousingDataService } from './data/austin-housing-data.service';
import { CryptoMarketDataService } from './data/crypto-market-data.service';

@Injectable({ providedIn: 'root' })
export class MarketService {
  private readonly cryptoData = inject(CryptoMarketDataService);
  private readonly housingData = inject(AustinHousingDataService);

  private readonly availableAssets: MarketAsset[] = [
    { id: 'bitcoin', name: 'Bitcoin', category: 'crypto', color: '#f7931a' },
    { id: 'ethereum', name: 'Ethereum', category: 'crypto', color: '#627eea' },
    { id: 'austin-real-estate', name: 'Austin Housing', category: 'real-estate', color: '#22c55e' },
  ];

  readonly selectedAsset = signal<MarketAsset | null>(null);
  readonly series = signal<DataPoint[]>([]);
  readonly latestPoint = computed<DataPoint | null>(() => {
    const points = this.series();
    return points.length > 0 ? points[points.length - 1] : null;
  });

  readonly range = signal<TimeRange>(this.loadRange());
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly austinMetricLabel = signal<string>('Median Sale Price');

  private readonly seriesCache = new Map<string, DataPoint[]>();
  private activeRequestToken = 0;

  getAssets(): MarketAsset[] {
    return this.availableAssets;
  }

  getRangeOptions(): { value: TimeRange; label: string }[] {
    return [
      { value: 'week', label: 'Week' },
      { value: 'month', label: 'Month' },
      { value: '3m', label: '3M' },
      { value: '6m', label: '6M' },
      { value: 'year', label: 'Year' },
      { value: '2y', label: '2Y' },
      { value: '5y', label: '5Y' },
      { value: 'max', label: 'Max' },
    ];
  }

  setRange(range: TimeRange): void {
    const asset = this.selectedAsset();
    const effectiveRange = asset ? this.normalizeRangeForAsset(asset, range) : range;

    this.range.set(effectiveRange);
    this.saveRange(effectiveRange);

    if (!asset) return;

    this.fetchForAsset(asset, effectiveRange);
  }

  selectAsset(asset: MarketAsset): void {
    this.selectedAsset.set(asset);
    this.error.set(null);
    this.austinMetricLabel.set('Median Sale Price');

    const effectiveRange = this.normalizeRangeForAsset(asset, this.range());
    if (effectiveRange !== this.range()) {
      this.range.set(effectiveRange);
      this.saveRange(effectiveRange);
    }

    this.fetchForAsset(asset, effectiveRange);
  }

  private fetchForAsset(asset: MarketAsset, range: TimeRange): void {
    const requestToken = this.nextRequestToken();
    const effectiveRange = this.normalizeRangeForAsset(asset, range);
    const cacheKey = `${asset.id}::${effectiveRange}`;
    const cached = this.seriesCache.get(cacheKey);
    if (cached && cached.length > 0) {
      this.error.set(null);
      this.isLoading.set(false);
      this.series.set(cached);
      return;
    }

    this.series.set([]);
    this.error.set(null);
    this.isLoading.set(true);

    if (asset.category === 'crypto') {
      this.fetchCryptoSeries(asset.id, effectiveRange, cacheKey, requestToken);
      return;
    }

    if (asset.category === 'real-estate' && asset.id === 'austin-real-estate') {
      this.fetchAustinHousingSeries(effectiveRange, cacheKey, requestToken);
      return;
    }

    if (!this.isRequestActive(requestToken)) return;
    this.error.set(`No data source wired up yet for category "${asset.category}".`);
    this.finishRequest(requestToken);
  }

  private fetchCryptoSeries(
    coinId: string,
    range: TimeRange,
    cacheKey: string,
    requestToken: number
  ): void {
    this.cryptoData
      .loadSeries(coinId, range)
      .subscribe({
        next: (points) => {
          if (!this.isRequestActive(requestToken)) return;

          this.series.set(points);

          if (points.length > 0) {
            this.seriesCache.set(cacheKey, points);
          }
        },
        error: (err: unknown) => {
          if (!this.isRequestActive(requestToken)) return;

          this.error.set(this.toUserError(err));
          this.finishRequest(requestToken);
        },
        complete: () => {
          this.finishRequest(requestToken);
        }
      });
  }

  private fetchAustinHousingSeries(
    range: TimeRange,
    cacheKey: string,
    requestToken: number
  ): void {
    this.housingData
      .loadSeries(range)
      .then((result) => {
        if (!this.isRequestActive(requestToken)) return;

        const points = this.filterSeriesByRange(result.points, range);
        if (points.length === 0) {
          throw new Error('No Austin housing price points found in source data.');
        }

        this.austinMetricLabel.set(result.metricLabel);
        this.seriesCache.set(cacheKey, points);
        this.series.set(points);
      })
      .catch((err: unknown) => {
        if (!this.isRequestActive(requestToken)) return;
        this.error.set(this.toAustinHousingError(err));
      })
      .finally(() => {
        this.finishRequest(requestToken);
      });
  }

  private nextRequestToken(): number {
    this.activeRequestToken += 1;
    return this.activeRequestToken;
  }

  private isRequestActive(token: number): boolean {
    return token === this.activeRequestToken;
  }

  private finishRequest(token: number): void {
    if (!this.isRequestActive(token)) return;
    this.isLoading.set(false);
  }

  private filterSeriesByRange(series: DataPoint[], range: TimeRange): DataPoint[] {
    if (!series.length) return [];
    if (range === 'max') return series;

    const latest = series[series.length - 1]?.date.getTime();
    if (!latest) return series;

    const days = this.mapRangeToDays(range);
    const cutoff = latest - days * 24 * 60 * 60 * 1000;

    const filtered = series.filter((point) => point.date.getTime() >= cutoff);
    return filtered.length > 0 ? filtered : series.slice(-1);
  }

  private mapRangeToDays(range: TimeRange): number {
    switch (range) {
      case 'week':
        return 7;
      case 'month':
        return 30;
      case '3m':
        return 90;
      case '6m':
        return 180;
      case 'year':
        return 365;
      case '2y':
        return 365 * 2;
      case '5y':
        return 365 * 5;
      case 'max':
      default:
        return Number.MAX_SAFE_INTEGER;
    }
  }

  private normalizeRangeForAsset(asset: MarketAsset, range: TimeRange): TimeRange {
    if (asset.id === 'austin-real-estate' && (range === 'week' || range === 'month')) {
      return '3m';
    }

    return range;
  }

  private loadRange(): TimeRange {
    try {
      const value = localStorage.getItem('range');
      const allowed = new Set<TimeRange>(['week', 'month', '3m', '6m', 'year', '2y', '5y', 'max']);
      return allowed.has(value as TimeRange) ? (value as TimeRange) : 'month';
    } catch {
      return 'month';
    }
  }

  private saveRange(range: TimeRange): void {
    try {
      localStorage.setItem('range', range);
    } catch {
      // ignore
    }
  }

  private toAustinHousingError(err: unknown): string {
    if (err instanceof Error && err.message) {
      return `Austin housing price request failed: ${err.message}`;
    }

    return 'Austin housing price request failed. Check network/proxy in DevTools.';
  }

  private toUserError(err: unknown): string {
    const fallback = 'Request failed. Check the Network tab for details.';

    if (!(err instanceof HttpErrorResponse)) return fallback;

    if (err.status === 0) {
      return 'Network error (status 0). Ensure `npm run dev` is running and /api is proxied.';
    }
    if (err.status === 404 && err.url?.includes('/api/')) {
      return 'API route not found (404). Ensure the Node API server is running.';
    }
    if (err.status === 429) {
      return 'CoinGecko rate limit hit (429).';
    }
    if (err.status === 401 || err.status === 403) {
      return 'CoinGecko rejected the request (401/403). Check API key and plan access.';
    }

    return `HTTP ${err.status}: ${err.message || 'Request failed.'}`;
  }
}
