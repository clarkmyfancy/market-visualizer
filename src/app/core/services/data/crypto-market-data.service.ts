import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';

import {
  CoinGeckoMarketChartResponse,
  DataPoint,
  TimeRange,
} from '../../../shared/models/market.model';

@Injectable({ providedIn: 'root' })
export class CryptoMarketDataService {
  private readonly http = inject(HttpClient);
  private readonly COINGECKO_PROXY_BASE_URL = '/api/coingecko';

  loadSeries(coinId: string, range: TimeRange): Observable<DataPoint[]> {
    const days = this.mapRangeToCoinGeckoDays(range);

    const params = new HttpParams()
      .set('vs_currency', 'usd')
      .set('days', days)
      .set('interval', 'daily');

    return this.http
      .get<CoinGeckoMarketChartResponse>(
        `${this.COINGECKO_PROXY_BASE_URL}/coins/${coinId}/market_chart`,
        { params }
      )
      .pipe(map((res) => this.normalizeMarketChart(res)));
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
      .map(([timestamp, value]) => ({ date: new Date(Number(timestamp)), value: Number(value) }))
      .filter((point) => Number.isFinite(point.value) && !Number.isNaN(point.date.getTime()));
  }
}
