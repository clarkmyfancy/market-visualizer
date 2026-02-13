import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { catchError, map, of } from 'rxjs';

import { CoinGeckoMarketChartResponse, DataPoint, MarketAsset } from '../../shared/models/market.model';

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

  // The chart should render this (NOT MarketAsset[])
  readonly series = signal<DataPoint[]>([]);

  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Simple in-memory cache per tab/session
  private readonly seriesCache = new Map<string, DataPoint[]>();

  getAssets(): MarketAsset[] {
    return this.availableAssets;
  }

  selectAsset(asset: MarketAsset): void {
    this.selectedAsset.set(asset);
    this.error.set(null);

    const cached = this.seriesCache.get(asset.id);
    if (cached && cached.length > 0) {
      this.series.set(cached);
      return;
    }

    // Clear prior series while loading a new one
    this.series.set([]);

    if (asset.category === 'crypto') {
      this.fetchCryptoSeries(asset.id, 30);
      return;
    }

    this.error.set(`No data source wired up yet for category "${asset.category}".`);
  }

  private fetchCryptoSeries(coinId: string, days: number): void {
    this.isLoading.set(true);
    this.error.set(null);

    let params = new HttpParams()
      .set('vs_currency', 'usd')
      .set('days', String(days))
      .set('interval', 'daily');

    // Optional: set this in DevTools:
    // localStorage.setItem('coingecko_demo_api_key', 'YOUR_KEY')
    const demoKey = this.getDemoApiKey();
    if (demoKey) {
      // Use query param to avoid custom-header CORS preflight issues
      params = params.set('x_cg_demo_api_key', demoKey);
    }

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
        // Avoid race conditions if user clicks assets quickly
        if (this.selectedAsset()?.id === coinId) {
          this.series.set(points);
        }

        if (points.length > 0) {
          this.seriesCache.set(coinId, points);
        }

        this.isLoading.set(false);
      });
  }

  private normalizeMarketChart(res: CoinGeckoMarketChartResponse): DataPoint[] {
    const prices = Array.isArray(res?.prices) ? res.prices : [];

    return prices
      .filter((tuple): tuple is [number, number] => Array.isArray(tuple) && tuple.length === 2)
      .map(([t, v]) => {
        const time = Number(t);
        const value = Number(v);
        return { date: new Date(time), value };
      })
      .filter((p) => Number.isFinite(p.value) && !Number.isNaN(p.date.getTime()));
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
      return 'CoinGecko rate limit hit (429). Add a Demo API key: localStorage["coingecko_demo_api_key"] = "…", then refresh.';
    }

    if (err.status === 401 || err.status === 403) {
      return 'CoinGecko rejected the request (401/403). You may need a Demo/Pro API key.';
    }

    return `HTTP ${err.status}: ${err.message || 'Request failed.'}`;
  }
}
