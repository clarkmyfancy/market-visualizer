import { Injectable, inject } from '@angular/core';

import { StockSeriesPort } from '../../ports/series-data.port';
import { TimeRange } from '../../../shared/models/market.model';
import { StockMarketDataService } from '../data/stock-market-data.service';

@Injectable({ providedIn: 'root' })
export class StockSeriesGateway implements StockSeriesPort {
  private readonly stockData = inject(StockMarketDataService);

  loadSeries(ticker: string, range: TimeRange) {
    return this.stockData.loadSeries(ticker, range);
  }
}
