import { Injectable, inject } from '@angular/core';

import { HousingSeriesData, HousingSeriesPort } from '../../ports/series-data.port';
import { TimeRange } from '../../../shared/models/market.model';
import { AustinHousingDataService } from '../data/austin-housing-data.service';

@Injectable({ providedIn: 'root' })
export class HousingSeriesGateway implements HousingSeriesPort {
  private readonly housingData = inject(AustinHousingDataService);

  loadSeries(range: TimeRange): Promise<HousingSeriesData> {
    return this.housingData.loadSeries(range);
  }
}
