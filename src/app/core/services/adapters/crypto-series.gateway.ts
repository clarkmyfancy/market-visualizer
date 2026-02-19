import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { DataPoint, TimeRange } from '../../../shared/models/market.model';
import { CryptoMarketDataService } from '../data/crypto-market-data.service';

@Injectable({ providedIn: 'root' })
export class CryptoSeriesGateway {
  private readonly cryptoData = inject(CryptoMarketDataService);

  loadSeries(coinId: string, range: TimeRange): Observable<DataPoint[]> {
    return this.cryptoData.loadSeries(coinId, range);
  }
}
