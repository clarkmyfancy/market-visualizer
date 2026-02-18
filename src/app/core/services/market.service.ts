import { Injectable, computed, inject, signal } from '@angular/core';
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
  private readonly API_BASE = this.resolveApiBase();

  // Use same-origin endpoints to avoid browser CORS failures against Redfin S3.
  // Metric used: median_sale_price for Austin, TX.
  private readonly REDFIN_CITY_TRACKER_GZ_URL = `${this.API_BASE}/api/redfin/city-market-tracker.gz`;
  private readonly REDFIN_METRO_TRACKER_GZ_URL = `${this.API_BASE}/api/redfin/metro-market-tracker.gz`;
  private readonly FRED_PROXY_AUSTIN_MEDIAN_LISTING_URL = `${this.API_BASE}/api/fred/austin-median-listing.csv`;
  private readonly FRED_AUSTIN_MEDIAN_LISTING_TXT_URL =
    'https://fred.stlouisfed.org/data/MEDLISPRI12420.txt';
  private readonly FRED_AUSTIN_MEDIAN_LISTING_CSV_URL =
    'https://fred.stlouisfed.org/graph/fredgraph.csv?id=MEDLISPRI12420';

  private readonly availableAssets: MarketAsset[] = [
    { id: 'bitcoin', name: 'Bitcoin', category: 'crypto', color: '#f7931a' },
    { id: 'ethereum', name: 'Ethereum', category: 'crypto', color: '#627eea' },
    { id: 'austin-real-estate', name: 'Austin Housing', category: 'real-estate', color: '#22c55e' },
  ];

  readonly selectedAsset = signal<MarketAsset | null>(null);

  // Chart series points (normalized)
  readonly series = signal<DataPoint[]>([]);

  readonly latestPoint = computed<DataPoint | null>(() => {
    const points = this.series();
    return points.length > 0 ? points[points.length - 1] : null;
  });

  // Range state
  readonly range = signal<TimeRange>(this.loadRange());

  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly austinMetricLabel = signal<string>('Median Sale Price');

  // Cache per asset+range
  private readonly seriesCache = new Map<string, DataPoint[]>();

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

    // Refetch for new range.
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
    const effectiveRange = this.normalizeRangeForAsset(asset, range);
    const cacheKey = `${asset.id}::${effectiveRange}`;
    const cached = this.seriesCache.get(cacheKey);
    if (cached && cached.length > 0) {
      this.series.set(cached);
      return;
    }

    this.series.set([]);

    if (asset.category === 'crypto') {
      this.fetchCryptoSeries(asset.id, effectiveRange, cacheKey);
      return;
    }

    if (asset.category === 'real-estate' && asset.id === 'austin-real-estate') {
      this.fetchAustinHousingSeries(asset.id, effectiveRange, cacheKey);
      return;
    }

    this.error.set(`No data source wired up yet for category "${asset.category}".`);
  }

  private fetchCryptoSeries(coinId: string, range: TimeRange, cacheKey: string): void {
    this.isLoading.set(true);
    this.error.set(null);

    const daysParam = this.mapRangeToCoinGeckoDays(range);

    let params = new HttpParams().set('vs_currency', 'usd').set('days', daysParam);

    // Keep point counts reasonable.
    params = params.set('interval', 'daily');

    // Optional demo key.
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
        // Avoid race conditions if user switches quickly.
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

  private fetchAustinHousingSeries(assetId: string, range: TimeRange, cacheKey: string): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.loadAustinHousingSeries(range)
      .then((result) => {
        const points = this.filterSeriesByRange(result.points, range);
        if (points.length === 0) {
          throw new Error('No Austin housing price points found in source data.');
        }

        this.austinMetricLabel.set(result.metricLabel);
        this.seriesCache.set(cacheKey, points);

        const current = this.selectedAsset();
        if (current?.id === assetId && this.range() === range) {
          this.series.set(points);
        }
      })
      .catch((err: unknown) => {
        const current = this.selectedAsset();
        if (current?.id === assetId && this.range() === range) {
          this.error.set(this.toAustinHousingError(err));
        }
      })
      .finally(() => {
        const current = this.selectedAsset();
        if (current?.id === assetId && this.range() === range) {
          this.isLoading.set(false);
        }
      });
  }

  private async loadAustinHousingSeries(
    range: TimeRange
  ): Promise<{ points: DataPoint[]; metricLabel: string }> {
    const { cosd, coed } = this.getDateWindowForRange(range);
    const fredProxyUrl = `${this.FRED_PROXY_AUSTIN_MEDIAN_LISTING_URL}?cosd=${encodeURIComponent(cosd)}&coed=${encodeURIComponent(coed)}`;
    const fredDirectTxtUrl = `${this.FRED_AUSTIN_MEDIAN_LISTING_TXT_URL}?cosd=${encodeURIComponent(cosd)}&coed=${encodeURIComponent(coed)}`;
    const fredDirectCsvUrl = `${this.FRED_AUSTIN_MEDIAN_LISTING_CSV_URL}&cosd=${encodeURIComponent(cosd)}&coed=${encodeURIComponent(coed)}`;

    const attemptsConfig: Array<{
      url: string;
      metricLabel: string;
      loader: (url: string) => Promise<DataPoint[]>;
      sourceLabel: string;
    }> = [
      {
        url: fredProxyUrl,
        metricLabel: 'Median Listing Price',
        loader: (url) => this.fetchFredHousingSeriesFromUrl(url),
        sourceLabel: 'FRED proxy csv',
      },
      {
        url: fredDirectTxtUrl,
        metricLabel: 'Median Listing Price',
        loader: (url) => this.fetchFredHousingSeriesFromUrl(url),
        sourceLabel: 'FRED txt',
      },
      {
        url: fredDirectCsvUrl,
        metricLabel: 'Median Listing Price',
        loader: (url) => this.fetchFredHousingSeriesFromUrl(url),
        sourceLabel: 'FRED csv',
      },
    ];

    const attempts: string[] = [];

    for (const attempt of attemptsConfig) {
      try {
        const points = await attempt.loader(attempt.url);
        if (points.length === 0) {
          attempts.push(`${attempt.sourceLabel}: no usable points at ${attempt.url}`);
          continue;
        }

        return { points, metricLabel: attempt.metricLabel };
      } catch (err) {
        if (err instanceof Error && err.message) {
          attempts.push(`${attempt.sourceLabel}: ${err.message}`);
        } else {
          attempts.push(`${attempt.sourceLabel}: Unknown error at ${attempt.url}.`);
        }
      }
    }

    if (attempts.length > 0) {
      throw new Error(`Unable to load Austin housing data. Attempts: ${attempts.join(' | ')}`);
    }

    throw new Error('Unable to load Austin housing data.');
  }

  private resolveApiBase(): string {
    if (typeof window === 'undefined') return '';

    const { hostname, port } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocal && port === '4200') {
      return 'http://localhost:8080';
    }

    return '';
  }

  private getDateWindowForRange(range: TimeRange): { cosd: string; coed: string } {
    const end = new Date();
    const start = new Date(end);

    switch (range) {
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
      case '3m':
        start.setMonth(start.getMonth() - 3);
        break;
      case '6m':
        start.setMonth(start.getMonth() - 6);
        break;
      case 'year':
        start.setFullYear(start.getFullYear() - 1);
        break;
      case '2y':
        start.setFullYear(start.getFullYear() - 2);
        break;
      case '5y':
        start.setFullYear(start.getFullYear() - 5);
        break;
      case 'max':
      default:
        start.setFullYear(2016, 0, 1);
        break;
    }

    const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
    return { cosd: toIsoDate(start), coed: toIsoDate(end) };
  }

  private async fetchAustinHousingSeriesFromUrl(url: string): Promise<DataPoint[]> {
    const response = await this.fetchWithTimeout(url, 8000);
    if (!response.ok) {
      let responseSnippet = '';
      try {
        const text = (await response.text()).replace(/\s+/g, ' ').trim();
        if (text) {
          responseSnippet = ` Response: ${text.slice(0, 140)}${text.length > 140 ? '…' : ''}`;
        }
      } catch {
        // ignore
      }

      throw new Error(`Redfin feed request failed (${response.status}) at ${url}.${responseSnippet}`);
    }

    const body = response.body;
    if (!body) {
      const text = await response.text();
      return this.parseAustinHousingTsvText(text);
    }

    let stream: ReadableStream<Uint8Array> = body;

    if (url.endsWith('.gz')) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser does not support gzip decompression streams.');
      }

      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }

    return this.parseAustinHousingTsvStream(stream);
  }

  private async fetchFredHousingSeriesFromUrl(url: string): Promise<DataPoint[]> {
    const response = await this.fetchWithTimeout(url, 8000);
    if (!response.ok) {
      throw new Error(`FRED feed request failed (${response.status}) at ${url}.`);
    }

    const text = await response.text();
    return this.parseFredHousingSeriesText(text);
  }

  private parseFredHousingSeriesText(text: string): DataPoint[] {
    const lines = text.split(/\r?\n/);
    const points: DataPoint[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const m = line.match(/^(\d{4}-\d{2}-\d{2})[,\s]+(.+)$/);
      if (!m) continue;

      const dateRaw = m[1].trim();
      const valueRaw = m[2].trim();
      if (!dateRaw || !valueRaw || valueRaw === '.') continue;

      const value = Number(valueRaw.replace(/,/g, ''));
      const date = new Date(`${dateRaw}T00:00:00Z`);
      if (!Number.isFinite(value) || Number.isNaN(date.getTime())) continue;

      points.push({ date, value });
    }

    return this.sortAndDedupe(points);
  }

  private async fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        cache: 'force-cache',
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Request timed out (${timeoutMs}ms) at ${url}.`);
      }
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  private async parseAustinHousingTsvStream(stream: ReadableStream<Uint8Array>): Promise<DataPoint[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let headers: string[] | null = null;

    const points: DataPoint[] = [];

    const processLine = (line: string): void => {
      if (!line) return;

      if (!headers) {
        headers = line.split('\t').map((h) => h.trim().toLowerCase());
        return;
      }

      const cells = line.split('\t');
      const row = this.toRowRecord(headers, cells);
      const point = this.toAustinMedianSalePoint(row);
      if (point) points.push(point);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });

      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        processLine(line);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) processLine(tail);

    return this.sortAndDedupe(points);
  }

  private parseAustinHousingTsvText(text: string): DataPoint[] {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].split('\t').map((h) => h.trim().toLowerCase());
    const points: DataPoint[] = [];

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;

      const cells = line.split('\t');
      const row = this.toRowRecord(headers, cells);
      const point = this.toAustinMedianSalePoint(row);
      if (point) points.push(point);
    }

    return this.sortAndDedupe(points);
  }

  private toRowRecord(headers: string[], cells: string[]): Record<string, string> {
    const row: Record<string, string> = {};

    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = (cells[i] ?? '').trim();
    }

    return row;
  }

  private toAustinMedianSalePoint(row: Record<string, string>): DataPoint | null {
    const regionType = (row['region_type'] ?? '').toLowerCase();
    if (regionType && regionType !== 'city' && regionType !== 'metro') return null;

    const city = (row['city'] ?? '').toLowerCase();
    const stateCode = (row['state_code'] ?? '').toLowerCase();
    const region = (row['region'] ?? '').toLowerCase();
    const regionTypeId = (row['region_type_id'] ?? '').toLowerCase();

    const isAustinCity = region === 'austin, tx' || (city === 'austin' && stateCode === 'tx');
    const isAustinMetro =
      region.includes('austin, tx') &&
      (region.includes('metro area') || regionType === 'metro' || regionTypeId.includes('metro'));
    const isAustin = isAustinCity || isAustinMetro;
    if (!isAustin) return null;

    const periodDuration = (row['period_duration'] ?? '').toLowerCase();
    if (periodDuration && !periodDuration.includes('1 month')) return null;

    const propertyType = (row['property_type'] ?? '').toLowerCase();
    if (propertyType && !propertyType.includes('all residential')) return null;

    const isSeasonallyAdjusted = (row['is_seasonally_adjusted'] ?? '').toLowerCase();
    if (isSeasonallyAdjusted === 't' || isSeasonallyAdjusted === 'true') return null;

    const dateRaw = row['period_end'] || row['period_begin'];
    const valueRaw = row['median_sale_price'] || '';

    if (!dateRaw || !valueRaw) return null;

    const value = Number(valueRaw.replace(/[$,]/g, ''));
    const date = new Date(`${dateRaw}T00:00:00Z`);

    if (!Number.isFinite(value) || Number.isNaN(date.getTime())) return null;

    return { date, value };
  }

  private sortAndDedupe(points: DataPoint[]): DataPoint[] {
    const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());

    const seen = new Set<number>();
    const deduped: DataPoint[] = [];

    for (const point of sorted) {
      const key = point.date.getTime();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(point);
    }

    return deduped;
  }

  private filterSeriesByRange(series: DataPoint[], range: TimeRange): DataPoint[] {
    if (!series.length) return [];
    if (range === 'max') return series;

    const latest = series[series.length - 1]?.date.getTime();
    if (!latest) return series;

    const days = this.mapRangeToDays(range);
    const cutoff = latest - days * 24 * 60 * 60 * 1000;

    const filtered = series.filter((p) => p.date.getTime() >= cutoff);
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

  private mapRangeToCoinGeckoDays(range: TimeRange): string {
    switch (range) {
      case 'week':
        return '7';
      case 'month':
        return '30';
      case '3m':
        return '90';
      case '6m':
        return '180';
      case 'year':
        return '365';
      case '2y':
        return String(365 * 2);
      case '5y':
        return String(365 * 5);
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
      const allowed = new Set<TimeRange>(['week', 'month', '3m', '6m', 'year', '2y', '5y', 'max']);
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

  private toAustinHousingError(err: unknown): string {
    if (err instanceof Error && err.message) {
      return `Austin housing price request failed: ${err.message}`;
    }

    return 'Austin housing price request failed. Check network/CORS in DevTools.';
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
