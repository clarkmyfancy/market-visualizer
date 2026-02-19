import { Injectable, inject } from '@angular/core';
import { CryptoSeriesPort } from '../../ports/series-data.port';
import { TimeRange } from '../../../shared/models/market.model';
import { CryptoMarketDataService } from '../data/crypto-market-data.service';

@Injectable({ providedIn: 'root' })
export class CryptoSeriesGateway implements CryptoSeriesPort {
  private readonly cryptoData = inject(CryptoMarketDataService);

  loadSeries(coinId: string, range: TimeRange) {
    return this.cryptoData.loadSeries(coinId, range);
  }
}
