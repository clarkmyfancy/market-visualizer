import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';

import { DataPoint, TimeRange } from '../../../shared/models/market.model';

type StockHistoryResponse = {
  prices: [number, number][];
};

@Injectable({ providedIn: 'root' })
export class StockMarketDataService {
  private readonly http = inject(HttpClient);
  private readonly STOCK_PROXY_BASE_URL = '/api/stocks';

  loadSeries(ticker: string, range: TimeRange): Observable<DataPoint[]> {
    const params = new HttpParams().set('range', range);

    return this.http
      .get<StockHistoryResponse>(`${this.STOCK_PROXY_BASE_URL}/${encodeURIComponent(ticker)}/history`, { params })
      .pipe(map((res) => this.normalizeHistoryResponse(res)));
  }

  private normalizeHistoryResponse(res: StockHistoryResponse): DataPoint[] {
    const prices = Array.isArray(res?.prices) ? res.prices : [];

    return prices
      .filter((tuple): tuple is [number, number] => Array.isArray(tuple) && tuple.length === 2)
      .map(([timestamp, value]) => ({ date: new Date(Number(timestamp)), value: Number(value) }))
      .filter((point) => Number.isFinite(point.value) && !Number.isNaN(point.date.getTime()));
  }
}
