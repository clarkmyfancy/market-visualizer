import { Injectable } from '@angular/core';

import { DataPoint, TimeRange } from '../../../shared/models/market.model';

@Injectable({ providedIn: 'root' })
export class AustinHousingDataService {
  private readonly FRED_PROXY_AUSTIN_MEDIAN_LISTING_URL = '/api/fred/austin-median-listing.csv';
  private readonly REQUEST_TIMEOUT_MS = 25000;

  async loadSeries(range: TimeRange): Promise<{ points: DataPoint[]; metricLabel: string }> {
    const { cosd, coed } = this.getDateWindowForRange(range);
    const requestPath = `${this.FRED_PROXY_AUSTIN_MEDIAN_LISTING_URL}?cosd=${encodeURIComponent(cosd)}&coed=${encodeURIComponent(coed)}`;
    const urls = this.buildCandidateUrls(requestPath);

    const attempts: string[] = [];
    try {
      const points = await this.fetchFredHousingSeriesFromUrl(urls[0]);
      if (points.length > 0) {
        return {
          points,
          metricLabel: 'Median Listing Price',
        };
      }

      attempts.push(`${urls[0]}: no usable points`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown request error.';
      attempts.push(`${urls[0]}: ${message}`);

      const fallbackUrl = urls[1];
      if (fallbackUrl && this.shouldTryDirectLocalFallback(message)) {
        try {
          const points = await this.fetchFredHousingSeriesFromUrl(fallbackUrl);
          if (points.length > 0) {
            return {
              points,
              metricLabel: 'Median Listing Price',
            };
          }
          attempts.push(`${fallbackUrl}: no usable points`);
        } catch (fallbackErr) {
          const fallbackMessage =
            fallbackErr instanceof Error ? fallbackErr.message : 'Unknown request error.';
          attempts.push(`${fallbackUrl}: ${fallbackMessage}`);
        }
      }
    }

    throw new Error(
      `No usable points returned by FRED for ${cosd} to ${coed}. Attempts: ${attempts.join(' | ')}`
    );
  }

  private getDateWindowForRange(range: TimeRange): { cosd: string; coed: string } {
    const end = new Date();
    end.setDate(end.getDate() - 1);
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

    const toIsoDate = (d: Date): string => {
      const y = d.getFullYear();
      const m = `${d.getMonth() + 1}`.padStart(2, '0');
      const day = `${d.getDate()}`.padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    return { cosd: toIsoDate(start), coed: toIsoDate(end) };
  }

  private async fetchFredHousingSeriesFromUrl(url: string): Promise<DataPoint[]> {
    const response = await this.fetchWithTimeout(url, this.REQUEST_TIMEOUT_MS);
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

      const match = line.match(/^(\d{4}-\d{2}-\d{2})[,\s]+(.+)$/);
      if (!match) continue;

      const dateRaw = match[1].trim();
      const valueRaw = match[2].trim();
      if (!dateRaw || !valueRaw || valueRaw === '.') continue;

      const value = Number(valueRaw.replace(/,/g, ''));
      const date = new Date(`${dateRaw}T00:00:00Z`);
      if (!Number.isFinite(value) || Number.isNaN(date.getTime())) continue;

      points.push({ date, value });
    }

    return this.sortAndDedupe(points);
  }

  private buildCandidateUrls(requestPath: string): string[] {
    if (typeof window === 'undefined') return [requestPath];

    const urls = [requestPath];
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isNgDevPort = window.location.port === '4200';
    if (isLocalHost && isNgDevPort) {
      urls.push(`http://localhost:8080${requestPath}`);
    }

    return urls;
  }

  private shouldTryDirectLocalFallback(errorMessage: string): boolean {
    const normalized = errorMessage.toLowerCase();
    return normalized.includes('(404)') || normalized.includes('networkerror') || normalized.includes('failed to fetch');
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
}
