import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Observable } from 'rxjs';

import {
  CRYPTO_SERIES_PORT,
  HOUSING_SERIES_PORT,
  STOCK_SERIES_PORT,
  type CryptoSeriesPort,
  type HousingSeriesData,
  type HousingSeriesPort,
  type StockSeriesPort,
} from '../../ports/series-data.port';
import { DataPoint, MarketAsset, TimeRange } from '../../../shared/models/market.model';
import { RangePolicyService } from './range-policy.service';

export type LoadSeriesResult = {
  points: DataPoint[];
  metricLabel?: string;
};

@Injectable({ providedIn: 'root' })
export class LoadSeriesUseCase {
  private readonly cryptoGateway = inject<CryptoSeriesPort>(CRYPTO_SERIES_PORT);
  private readonly stockGateway = inject<StockSeriesPort>(STOCK_SERIES_PORT);
  private readonly housingGateway = inject<HousingSeriesPort>(HOUSING_SERIES_PORT);
  private readonly rangePolicy = inject(RangePolicyService);

  loadCryptoSeries(coinId: string, range: TimeRange): Observable<DataPoint[]> {
    return this.cryptoGateway.loadSeries(coinId, range);
  }

  loadStockSeries(ticker: string, range: TimeRange): Observable<DataPoint[]> {
    return this.stockGateway.loadSeries(ticker, range);
  }

  async loadHousingSeries(range: TimeRange): Promise<LoadSeriesResult> {
    const result: HousingSeriesData = await this.housingGateway.loadSeries(range);
    const points = this.rangePolicy.filterSeriesByRange(result.points, range);
    if (points.length === 0) {
      throw new Error('No Austin housing price points found in source data.');
    }

    return {
      points,
      metricLabel: result.metricLabel,
    };
  }

  async loadFullSeries(asset: MarketAsset): Promise<DataPoint[]> {
    if (asset.category === 'crypto') {
      return firstValueFrom(this.cryptoGateway.loadSeries(asset.id, 'year'));
    }

    if (asset.category === 'stock') {
      return firstValueFrom(this.stockGateway.loadSeries(asset.id, 'max'));
    }

    if (asset.category === 'real-estate' && asset.id === 'austin-real-estate') {
      const result = await this.housingGateway.loadSeries('max');
      return result.points;
    }

    throw new Error(`No full-series data source is wired for "${asset.name}".`);
  }
}
