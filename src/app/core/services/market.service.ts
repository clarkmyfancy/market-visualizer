import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { DataPoint, MarketAsset, TimeRange } from '../../shared/models/market.model';
import { ChartLine, ChartPoint } from '../../shared/models/chart.model';
import { AustinHousingDataService } from './data/austin-housing-data.service';
import { CryptoMarketDataService } from './data/crypto-market-data.service';

@Injectable({ providedIn: 'root' })
export class MarketService {
  private readonly cryptoData = inject(CryptoMarketDataService);
  private readonly housingData = inject(AustinHousingDataService);

  private readonly availableAssets: MarketAsset[] = [
    { id: 'bitcoin', name: 'Bitcoin', category: 'crypto', color: '#f7931a' },
    { id: 'ethereum', name: 'Ethereum', category: 'crypto', color: '#627eea' },
    { id: 'tether-gold', name: 'Gold', category: 'crypto', color: '#d4af37' },
    { id: 'austin-real-estate', name: 'Austin Housing', category: 'real-estate', color: '#22c55e' },
  ];
  private readonly rangeOptions: { value: TimeRange; label: string }[] = [
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: '3m', label: '3M' },
    { value: '6m', label: '6M' },
    { value: 'year', label: 'Year' },
    { value: '2y', label: '2Y' },
    { value: '5y', label: '5Y' },
    { value: 'max', label: 'Max' },
  ];
  private readonly compareCryptoBlockedRanges = new Set<TimeRange>(['2y', '5y', 'max']);

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

    const aligned = this.alignSeriesWithStepHold(primaryFullSeries, secondaryFullSeries);
    const visibleAligned = this.filterAlignedSeriesByRange(
      aligned.primary,
      aligned.secondary,
      this.range()
    );
    const normalizedPrimary = this.normalizeSeriesToPercentChange(visibleAligned.primary);
    const normalizedSecondary = this.normalizeSeriesToPercentChange(visibleAligned.secondary);

    return [
      {
        assetId: primaryAsset.id,
        assetName: primaryAsset.name,
        color: primaryAsset.color,
        strokeStyle: 'solid',
        points: normalizedPrimary,
      },
      {
        assetId: secondaryAsset.id,
        assetName: secondaryAsset.name,
        color: secondaryAsset.color,
        strokeStyle: 'dashed',
        points: normalizedSecondary,
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
    return this.rangeOptions;
  }

  getVisibleRangeOptions(): { value: TimeRange; label: string }[] {
    if (!this.shouldLimitRangesForCryptoCompare()) {
      return this.rangeOptions;
    }

    return this.rangeOptions.filter((option) => !this.compareCryptoBlockedRanges.has(option.value));
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
    const effectiveRange = asset ? this.normalizeRangeForContext(asset, range) : range;

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

    const effectiveRange = this.normalizeRangeForContext(asset, this.range());
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

    const request = this.loadFullSeriesForAsset(asset)
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

  private async loadFullSeriesForAsset(asset: MarketAsset): Promise<DataPoint[]> {
    if (asset.category === 'crypto') {
      return firstValueFrom(this.cryptoData.loadSeries(asset.id, 'year'));
    }

    if (asset.category === 'real-estate' && asset.id === 'austin-real-estate') {
      const result = await this.housingData.loadSeries('max');
      return result.points;
    }

    throw new Error(`No full-series data source is wired for "${asset.name}".`);
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

  private alignSeriesWithStepHold(
    primarySeries: DataPoint[],
    secondarySeries: DataPoint[]
  ): { primary: ChartPoint[]; secondary: ChartPoint[] } {
    const allTimestamps = new Set<number>();

    for (const point of primarySeries) {
      allTimestamps.add(point.date.getTime());
    }

    for (const point of secondarySeries) {
      allTimestamps.add(point.date.getTime());
    }

    const sortedTimestamps = Array.from(allTimestamps.values()).sort((a, b) => a - b);

    const alignedPrimary: ChartPoint[] = [];
    const alignedSecondary: ChartPoint[] = [];

    let primaryIndex = 0;
    let secondaryIndex = 0;
    let latestPrimary: number | null = null;
    let latestSecondary: number | null = null;

    for (const timestamp of sortedTimestamps) {
      while (
        primaryIndex < primarySeries.length &&
        primarySeries[primaryIndex].date.getTime() <= timestamp
      ) {
        latestPrimary = primarySeries[primaryIndex].value;
        primaryIndex += 1;
      }

      while (
        secondaryIndex < secondarySeries.length &&
        secondarySeries[secondaryIndex].date.getTime() <= timestamp
      ) {
        latestSecondary = secondarySeries[secondaryIndex].value;
        secondaryIndex += 1;
      }

      const date = new Date(timestamp);
      alignedPrimary.push({ date, value: latestPrimary });
      alignedSecondary.push({ date, value: latestSecondary });
    }

    return { primary: alignedPrimary, secondary: alignedSecondary };
  }

  private normalizeSeriesToPercentChange(series: ChartPoint[]): ChartPoint[] {
    const basePoint = series.find(
      (point) => point.value != null && Number.isFinite(point.value)
    );
    const baseValue = basePoint?.value;

    if (!Number.isFinite(baseValue) || baseValue === 0) {
      return series.map((point) => ({ date: point.date, value: null }));
    }

    return series.map((point) => {
      if (point.value == null || !Number.isFinite(point.value)) {
        return { date: point.date, value: null };
      }

      const normalized = ((point.value / baseValue) - 1) * 100;

      return {
        date: point.date,
        value: Number.isFinite(normalized) ? normalized : null,
      };
    });
  }

  private filterAlignedSeriesByRange(
    primary: ChartPoint[],
    secondary: ChartPoint[],
    range: TimeRange
  ): { primary: ChartPoint[]; secondary: ChartPoint[] } {
    if (!primary.length || !secondary.length) {
      return { primary: [], secondary: [] };
    }

    if (range === 'max') {
      return { primary, secondary };
    }

    const latest = primary[primary.length - 1].date.getTime();
    const days = this.mapRangeToDays(range);
    const cutoff = latest - days * 24 * 60 * 60 * 1000;

    const firstVisibleIndex = primary.findIndex((point) => point.date.getTime() >= cutoff);
    if (firstVisibleIndex === -1) {
      return {
        primary: primary.slice(-1),
        secondary: secondary.slice(-1),
      };
    }

    return {
      primary: primary.slice(firstVisibleIndex),
      secondary: secondary.slice(firstVisibleIndex),
    };
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
        },
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

  private normalizeRangeForContext(asset: MarketAsset, range: TimeRange): TimeRange {
    const assetAdjusted = this.normalizeRangeForAsset(asset, range);

    if (this.shouldLimitRangesForCryptoCompare() && this.compareCryptoBlockedRanges.has(assetAdjusted)) {
      return 'year';
    }

    return assetAdjusted;
  }

  private enforceRangeForCurrentContext(fetchPrimarySeries: boolean): void {
    const primaryAsset = this.selectedAsset();
    if (!primaryAsset) return;

    const currentRange = this.range();
    const effectiveRange = this.normalizeRangeForContext(primaryAsset, currentRange);

    if (effectiveRange === currentRange) return;

    this.range.set(effectiveRange);
    this.saveRange(effectiveRange);

    if (fetchPrimarySeries) {
      this.fetchForAsset(primaryAsset, effectiveRange);
    }
  }

  private shouldLimitRangesForCryptoCompare(): boolean {
    if (!this.compareEnabled()) return false;

    const primaryAsset = this.selectedAsset();
    if (!primaryAsset) return false;
    if (primaryAsset.category === 'crypto') return true;

    const secondaryAsset = this.getSecondaryAsset();
    return secondaryAsset?.category === 'crypto';
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
