import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

import { DataPoint, TimeRange } from '../../shared/models/market.model';

export type HousingSeriesData = {
  points: DataPoint[];
  metricLabel: string;
};

export interface CryptoSeriesPort {
  loadSeries(coinId: string, range: TimeRange): Observable<DataPoint[]>;
}

export interface StockSeriesPort {
  loadSeries(ticker: string, range: TimeRange): Observable<DataPoint[]>;
}

export interface HousingSeriesPort {
  loadSeries(range: TimeRange): Promise<HousingSeriesData>;
}

export const CRYPTO_SERIES_PORT = new InjectionToken<CryptoSeriesPort>('CRYPTO_SERIES_PORT');
export const STOCK_SERIES_PORT = new InjectionToken<StockSeriesPort>('STOCK_SERIES_PORT');
export const HOUSING_SERIES_PORT = new InjectionToken<HousingSeriesPort>('HOUSING_SERIES_PORT');
