import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { ChartLine } from '../../shared/models/chart.model';
import { DataPoint, MarketAsset, TimeRange } from '../../shared/models/market.model';
import { STORAGE_KEYS, StoragePort } from '../ports/storage.port';
import { CompareSeriesUseCase } from './use-cases/compare-series.use-case';
import { LoadSeriesUseCase } from './use-cases/load-series.use-case';
import { RangePolicyService } from './use-cases/range-policy.service';

@Injectable({ providedIn: 'root' })
export class MarketFacade {
  private readonly compareSeries = inject(CompareSeriesUseCase);
  private readonly loadSeries = inject(LoadSeriesUseCase);
  private readonly rangePolicy = inject(RangePolicyService);
  private readonly storage = inject(StoragePort);

  private readonly availableAssets: MarketAsset[] = [
    { id: 'bitcoin', name: 'Bitcoin', category: 'crypto', color: '#f7931a' },
    { id: 'ethereum', name: 'Ethereum', category: 'crypto', color: '#627eea' },
    { id: 'tether-gold', name: 'Gold', category: 'crypto', color: '#d4af37' },
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

  readonly compareEnabled = signal<boolean>(false);
  readonly secondaryAssetId = signal<string | null>(null);

  private readonly fullSeriesByAsset = signal<Map<string, DataPoint[]>>(new Map());
  private readonly fullSeriesLoadingAssets = signal<Set<string>>(new Set());
  private readonly fullSeriesInFlight = new Map<string, Promise<DataPoint[]>>();

  readonly isCompareLoading = computed<boolean>(() => {
    if (!this.compareEnabled()) return false;
    return this.fullSeriesLoadingAssets().size > 0;
  });

  readonly chartLines = computed<ChartLine[]>(() => {
    const primaryAsset = this.selectedAsset();
    if (!primaryAsset) return [];

    if (!this.compareEnabled()) {
      return [
        {
          assetId: primaryAsset.id,
          assetName: primaryAsset.name,
          color: primaryAsset.color,
          strokeStyle: 'solid',
          points: this.series().map((point) => ({ date: point.date, value: point.value })),
        },
      ];
    }

    const secondaryAsset = this.getSecondaryAsset();
    if (!secondaryAsset) return [];

    const fullSeriesMap = this.fullSeriesByAsset();
    const primaryFullSeries = fullSeriesMap.get(primaryAsset.id);
    const secondaryFullSeries = fullSeriesMap.get(secondaryAsset.id);

    if (!primaryFullSeries?.length || !secondaryFullSeries?.length) return [];

    const normalized = this.compareSeries.buildNormalizedCompareSeries(
      primaryFullSeries,
      secondaryFullSeries,
      this.range()
    );

    return [
      {
        assetId: primaryAsset.id,
        assetName: primaryAsset.name,
        color: primaryAsset.color,
        strokeStyle: 'solid',
        points: normalized.primary,
      },
      {
        assetId: secondaryAsset.id,
        assetName: secondaryAsset.name,
        color: secondaryAsset.color,
        strokeStyle: 'dashed',
        points: normalized.secondary,
      },
    ];
  });

  private readonly seriesCache = new Map<string, DataPoint[]>();
  private activeRequestToken = 0;

  getAssets(): MarketAsset[] {
    return this.availableAssets;
  }

  getCompareAssetOptions(): MarketAsset[] {
    const primaryAssetId = this.selectedAsset()?.id;
    if (!primaryAssetId) return this.availableAssets;

    return this.availableAssets.filter((asset) => asset.id !== primaryAssetId);
  }

  getSecondaryAsset(): MarketAsset | null {
    const secondaryId = this.secondaryAssetId();
    if (!secondaryId) return null;

    return this.availableAssets.find((asset) => asset.id === secondaryId) ?? null;
  }

  getRangeOptions(): { value: TimeRange; label: string }[] {
    return this.rangePolicy.getRangeOptions();
  }

  getVisibleRangeOptions(): { value: TimeRange; label: string }[] {
    return this.rangePolicy.getVisibleRangeOptions(
      this.compareEnabled(),
      this.selectedAsset(),
      this.getSecondaryAsset()
    );
  }

  setCompareEnabled(enabled: boolean): void {
    if (enabled) {
      const primaryAsset = this.selectedAsset();
      if (primaryAsset) {
        this.ensureValidSecondaryAsset(primaryAsset.id);
      }
    }

    this.compareEnabled.set(enabled);

    if (!enabled) return;

    const primaryAsset = this.selectedAsset();
    if (!primaryAsset) return;

    this.ensureValidSecondaryAsset(primaryAsset.id);
    this.enforceRangeForCurrentContext(true);
    void this.preloadCompareSeries();
  }

  setSecondaryAsset(assetId: string): void {
    const primaryAssetId = this.selectedAsset()?.id;

    if (!assetId || assetId === primaryAssetId) return;
    const candidate = this.availableAssets.find((asset) => asset.id === assetId);
    if (!candidate) return;

    this.secondaryAssetId.set(candidate.id);

    if (this.compareEnabled()) {
      this.enforceRangeForCurrentContext(true);
      void this.preloadCompareSeries();
    }
  }

  setRange(range: TimeRange): void {
    const asset = this.selectedAsset();
    const secondaryAsset = this.getSecondaryAsset();
    const effectiveRange = asset
      ? this.rangePolicy.normalizeRangeForContext(
          this.compareEnabled(),
          asset,
          secondaryAsset,
          range
        )
      : range;

    this.range.set(effectiveRange);
    this.saveRange(effectiveRange);

    if (!asset) return;

    this.fetchForAsset(asset, effectiveRange);
  }

  selectAsset(asset: MarketAsset): void {
    this.selectedAsset.set(asset);
    this.error.set(null);
    this.austinMetricLabel.set('Median Sale Price');

    if (this.compareEnabled()) {
      this.ensureValidSecondaryAsset(asset.id);
      void this.preloadCompareSeries();
    }

    const effectiveRange = this.rangePolicy.normalizeRangeForContext(
      this.compareEnabled(),
      asset,
      this.getSecondaryAsset(),
      this.range()
    );
    if (effectiveRange !== this.range()) {
      this.range.set(effectiveRange);
      this.saveRange(effectiveRange);
    }

    this.fetchForAsset(asset, effectiveRange);
  }

  private async preloadCompareSeries(): Promise<void> {
    if (!this.compareEnabled()) return;

    const primaryAsset = this.selectedAsset();
    const secondaryAsset = this.getSecondaryAsset();

    if (!primaryAsset || !secondaryAsset) return;

    try {
      await Promise.all([
        this.ensureFullSeriesLoaded(primaryAsset),
        this.ensureFullSeriesLoaded(secondaryAsset),
      ]);
    } catch (err: unknown) {
      this.error.set(this.toCompareError(err));
    }
  }

  private ensureValidSecondaryAsset(primaryAssetId: string): void {
    const secondaryId = this.secondaryAssetId();

    if (secondaryId && secondaryId !== primaryAssetId) {
      const exists = this.availableAssets.some((asset) => asset.id === secondaryId);
      if (exists) return;
    }

    const fallbackId = this.pickDefaultSecondaryAssetId(primaryAssetId);
    this.secondaryAssetId.set(fallbackId);
  }

  private pickDefaultSecondaryAssetId(primaryAssetId: string): string | null {
    if (this.availableAssets.length <= 1) return null;

    const primaryIndex = this.availableAssets.findIndex((asset) => asset.id === primaryAssetId);
    if (primaryIndex === -1) {
      return this.availableAssets[0]?.id ?? null;
    }

    for (let offset = 1; offset < this.availableAssets.length; offset += 1) {
      const candidate = this.availableAssets[(primaryIndex + offset) % this.availableAssets.length];
      if (candidate && candidate.id !== primaryAssetId) {
        return candidate.id;
      }
    }

    return null;
  }

  private ensureFullSeriesLoaded(asset: MarketAsset): Promise<DataPoint[]> {
    const cached = this.fullSeriesByAsset().get(asset.id);
    if (cached && cached.length > 0) {
      return Promise.resolve(cached);
    }

    const inFlight = this.fullSeriesInFlight.get(asset.id);
    if (inFlight) {
      return inFlight;
    }

    this.markFullSeriesLoading(asset.id, true);

    const request = this.loadSeries.loadFullSeries(asset)
      .then((points) => {
        const sanitized = this.sanitizeSeries(points);

        this.fullSeriesByAsset.update((prev) => {
          const next = new Map(prev);
          next.set(asset.id, sanitized);
          return next;
        });

        return sanitized;
      })
      .finally(() => {
        this.fullSeriesInFlight.delete(asset.id);
        this.markFullSeriesLoading(asset.id, false);
      });

    this.fullSeriesInFlight.set(asset.id, request);
    return request;
  }

  private markFullSeriesLoading(assetId: string, loading: boolean): void {
    this.fullSeriesLoadingAssets.update((prev) => {
      const next = new Set(prev);
      if (loading) {
        next.add(assetId);
      } else {
        next.delete(assetId);
      }
      return next;
    });
  }

  private sanitizeSeries(series: DataPoint[]): DataPoint[] {
    const sorted = [...series]
      .filter(
        (point) =>
          Number.isFinite(point.value) &&
          !Number.isNaN(point.date.getTime())
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const deduped: DataPoint[] = [];
    let lastTimestamp: number | null = null;

    for (const point of sorted) {
      const timestamp = point.date.getTime();
      if (lastTimestamp === timestamp) {
        deduped[deduped.length - 1] = point;
        continue;
      }

      deduped.push(point);
      lastTimestamp = timestamp;
    }

    return deduped;
  }

  private fetchForAsset(asset: MarketAsset, range: TimeRange): void {
    const requestToken = this.nextRequestToken();
    const effectiveRange = this.rangePolicy.normalizeRangeForContext(
      this.compareEnabled(),
      asset,
      this.getSecondaryAsset(),
      range
    );
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
      this.loadSeries.loadCryptoSeries(asset.id, effectiveRange).subscribe({
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
        },
      });
      return;
    }

    if (asset.category === 'real-estate' && asset.id === 'austin-real-estate') {
      this.loadSeries.loadHousingSeries(effectiveRange)
        .then((result) => {
          if (!this.isRequestActive(requestToken)) return;

          const points = result.points;
          if (result.metricLabel) {
            this.austinMetricLabel.set(result.metricLabel);
          }

          this.series.set(points);
          if (points.length > 0) {
            this.seriesCache.set(cacheKey, points);
          }
        })
        .catch((err: unknown) => {
          if (!this.isRequestActive(requestToken)) return;
          this.error.set(this.toAustinHousingError(err));
        })
        .finally(() => {
          this.finishRequest(requestToken);
        });
      return;
    }

    if (!this.isRequestActive(requestToken)) return;
    this.error.set(`No data source wired up yet for category "${asset.category}".`);
    this.finishRequest(requestToken);
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

  private enforceRangeForCurrentContext(fetchPrimarySeries: boolean): void {
    const primaryAsset = this.selectedAsset();
    if (!primaryAsset) return;

    const currentRange = this.range();
    const effectiveRange = this.rangePolicy.normalizeRangeForContext(
      this.compareEnabled(),
      primaryAsset,
      this.getSecondaryAsset(),
      currentRange
    );

    if (effectiveRange === currentRange) return;

    this.range.set(effectiveRange);
    this.saveRange(effectiveRange);

    if (fetchPrimarySeries) {
      this.fetchForAsset(primaryAsset, effectiveRange);
    }
  }

  private loadRange(): TimeRange {
    const value = this.storage.getItem(STORAGE_KEYS.RANGE);
    const allowed = new Set<TimeRange>(['week', 'month', '3m', '6m', 'year', '2y', '5y', 'max']);
    return allowed.has(value as TimeRange) ? (value as TimeRange) : 'month';
  }

  private saveRange(range: TimeRange): void {
    this.storage.setItem(STORAGE_KEYS.RANGE, range);
  }

  private toCompareError(err: unknown): string {
    if (err instanceof Error && err.message) {
      return `Compare data request failed: ${err.message}`;
    }

    return 'Compare data request failed. Check network/proxy in DevTools.';
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

export { MarketFacade as MarketService };
