import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { catchError, map, of } from 'rxjs';

import {
  CoinGeckoMarketChartResponse,
  DataPoint,
  MarketAsset,
  TimeRange,
} from '../../shared/models/market.model';

@Injectable({ providedIn: 'root' })
export class MarketService {
  private readonly http = inject(HttpClient);
  private readonly COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

  private readonly availableAssets: MarketAsset[] = [
    { id: 'bitcoin', name: 'Bitcoin', category: 'crypto', color: '#f7931a' },
    { id: 'ethereum', name: 'Ethereum', category: 'crypto', color: '#627eea' },
    { id: 'austin-real-estate', name: 'Austin Housing', category: 'real-estate', color: '#22c55e' },
  ];

  readonly selectedAsset = signal<MarketAsset | null>(null);

  // Chart series points (normalized)
  readonly series = signal<DataPoint[]>([]);

  // Range state
  readonly range = signal<TimeRange>(this.loadRange());

  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Cache per asset+range
  private readonly seriesCache = new Map<string, DataPoint[]>();

  getAssets(): MarketAsset[] {
    return this.availableAssets;
  }

  getRangeOptions(): { value: TimeRange; label: string }[] {
    return [
      { value: 'day', label: 'Day' },     // last 60 days (per your request)
      { value: 'week', label: 'Week' },
      { value: 'month', label: 'Month' },
      { value: 'year', label: 'Year' },
      { value: '2y', label: '2Y' },
      { value: '4y', label: '4Y' },
      { value: '8y', label: '8Y' },
      { value: 'max', label: 'Max' },
    ];
  }

  setRange(range: TimeRange): void {
    this.range.set(range);
    this.saveRange(range);

    const asset = this.selectedAsset();
    if (!asset) return;

    // Refetch for new range
    this.fetchForAsset(asset, range);
  }

  selectAsset(asset: MarketAsset): void {
    this.selectedAsset.set(asset);
    this.error.set(null);

    this.fetchForAsset(asset, this.range());
  }

  private fetchForAsset(asset: MarketAsset, range: TimeRange): void {
    const cacheKey = `${asset.id}::${range}`;
    const cached = this.seriesCache.get(cacheKey);
    if (cached && cached.length > 0) {
      this.series.set(cached);
      return;
    }

    this.series.set([]);

    if (asset.category === 'crypto') {
      this.fetchCryptoSeries(asset.id, range, cacheKey);
      return;
    }

    this.error.set(`No data source wired up yet for category "${asset.category}".`);
  }

  private fetchCryptoSeries(coinId: string, range: TimeRange, cacheKey: string): void {
    this.isLoading.set(true);
    this.error.set(null);

    const daysParam = this.mapRangeToCoinGeckoDays(range);

    let params = new HttpParams()
      .set('vs_currency', 'usd')
      .set('days', daysParam);

    // Keep point counts reasonable
    // CoinGecko accepts interval=daily (and will auto-adjust for shorter ranges)
    params = params.set('interval', 'daily');

    // Optional demo key
    const demoKey = this.getDemoApiKey();
    if (demoKey) params = params.set('x_cg_demo_api_key', demoKey);

    const url = `${this.COINGECKO_BASE_URL}/coins/${coinId}/market_chart`;

    this.http
      .get<CoinGeckoMarketChartResponse>(url, { params })
      .pipe(
        map((res) => this.normalizeMarketChart(res)),
        catchError((err: unknown) => {
          this.error.set(this.toUserError(err));
          return of([] as DataPoint[]);
        })
      )
      .subscribe((points) => {
        // Avoid race conditions if user switches quickly
        const current = this.selectedAsset();
        if (current?.id === coinId && this.range() === range) {
          this.series.set(points);
        }

        if (points.length > 0) {
          this.seriesCache.set(cacheKey, points);
        }

        this.isLoading.set(false);
      });
  }

  private mapRangeToCoinGeckoDays(range: TimeRange): string {
    // Your requirement: "day" should go back last 60 days
    switch (range) {
      case 'day':
        return '60';
      case 'week':
        return '7';
      case 'month':
        return '30';
      case 'year':
        return '365';
      case '2y':
        return String(365 * 2);
      case '4y':
        return String(365 * 4);
      case '8y':
        return String(365 * 8);
      case 'max':
        return 'max';
      default:
        return '30';
    }
  }

  private normalizeMarketChart(res: CoinGeckoMarketChartResponse): DataPoint[] {
    const prices = Array.isArray(res?.prices) ? res.prices : [];

    return prices
      .filter((tuple): tuple is [number, number] => Array.isArray(tuple) && tuple.length === 2)
      .map(([t, v]) => ({ date: new Date(Number(t)), value: Number(v) }))
      .filter((p) => Number.isFinite(p.value) && !Number.isNaN(p.date.getTime()));
  }

  private loadRange(): TimeRange {
    try {
      const v = localStorage.getItem('range');
      const allowed = new Set<TimeRange>(['day', 'week', 'month', 'year', '2y', '4y', '8y', 'max']);
      return allowed.has(v as TimeRange) ? (v as TimeRange) : 'month';
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

  private getDemoApiKey(): string | null {
    try {
      return localStorage.getItem('coingecko_demo_api_key');
    } catch {
      return null;
    }
  }

  private toUserError(err: unknown): string {
    const fallback = 'Request failed. Check the Network tab for details.';

    if (!(err instanceof HttpErrorResponse)) return fallback;

    if (err.status === 0) {
      return 'Network error (status 0). Usually CORS, a blocked request, or you are offline.';
    }
    if (err.status === 429) {
      return 'CoinGecko rate limit hit (429). Add a Demo API key in localStorage and refresh.';
    }
    if (err.status === 401 || err.status === 403) {
      return 'CoinGecko rejected the request (401/403). You may need a Demo/Pro API key.';
    }

    return `HTTP ${err.status}: ${err.message || 'Request failed.'}`;
  }
}
