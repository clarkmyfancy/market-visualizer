import { Provider } from '@angular/core';

import { CRYPTO_SERIES_PORT, HOUSING_SERIES_PORT, STOCK_SERIES_PORT } from '../../ports/series-data.port';
import { CryptoSeriesGateway } from './crypto-series.gateway';
import { HousingSeriesGateway } from './housing-series.gateway';
import { StockSeriesGateway } from './stock-series.gateway';

export const SERIES_DATA_PORT_PROVIDERS: Provider[] = [
  CryptoSeriesGateway,
  StockSeriesGateway,
  HousingSeriesGateway,
  { provide: CRYPTO_SERIES_PORT, useExisting: CryptoSeriesGateway },
  { provide: STOCK_SERIES_PORT, useExisting: StockSeriesGateway },
  { provide: HOUSING_SERIES_PORT, useExisting: HousingSeriesGateway },
];
