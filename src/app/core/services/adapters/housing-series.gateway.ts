import { Injectable, inject } from '@angular/core';

import { DataPoint, TimeRange } from '../../../shared/models/market.model';
import { AustinHousingDataService } from '../data/austin-housing-data.service';

export type HousingSeriesResult = {
  points: DataPoint[];
  metricLabel: string;
};

@Injectable({ providedIn: 'root' })
export class HousingSeriesGateway {
  private readonly housingData = inject(AustinHousingDataService);

  loadSeries(range: TimeRange): Promise<HousingSeriesResult> {
    return this.housingData.loadSeries(range);
  }
}
