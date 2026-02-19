import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Observable } from 'rxjs';

import { DataPoint, MarketAsset, TimeRange } from '../../../shared/models/market.model';
import { CryptoSeriesGateway } from '../adapters/crypto-series.gateway';
import { HousingSeriesGateway } from '../adapters/housing-series.gateway';
import { RangePolicyService } from './range-policy.service';

export type LoadSeriesResult = {
  points: DataPoint[];
  metricLabel?: string;
};

@Injectable({ providedIn: 'root' })
export class LoadSeriesUseCase {
  private readonly cryptoGateway = inject(CryptoSeriesGateway);
  private readonly housingGateway = inject(HousingSeriesGateway);
  private readonly rangePolicy = inject(RangePolicyService);

  loadCryptoSeries(coinId: string, range: TimeRange): Observable<DataPoint[]> {
    return this.cryptoGateway.loadSeries(coinId, range);
  }

  async loadHousingSeries(range: TimeRange): Promise<LoadSeriesResult> {
    const result = await this.housingGateway.loadSeries(range);
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

    if (asset.category === 'real-estate' && asset.id === 'austin-real-estate') {
      const result = await this.housingGateway.loadSeries('max');
      return result.points;
    }

    throw new Error(`No full-series data source is wired for "${asset.name}".`);
  }
}
