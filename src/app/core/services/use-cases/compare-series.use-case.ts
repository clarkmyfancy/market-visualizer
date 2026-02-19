import { Injectable, inject } from '@angular/core';

import { ChartPoint } from '../../../shared/models/chart.model';
import { DataPoint, TimeRange } from '../../../shared/models/market.model';
import { RangePolicyService } from './range-policy.service';

@Injectable({ providedIn: 'root' })
export class CompareSeriesUseCase {
  private readonly rangePolicy = inject(RangePolicyService);

  buildNormalizedCompareSeries(
    primarySeries: DataPoint[],
    secondarySeries: DataPoint[],
    range: TimeRange
  ): { primary: ChartPoint[]; secondary: ChartPoint[] } {
    const aligned = this.alignSeriesWithStepHold(primarySeries, secondarySeries);
    const visibleAligned = this.filterAlignedSeriesByRange(aligned.primary, aligned.secondary, range);

    return {
      primary: this.normalizeSeriesToPercentChange(visibleAligned.primary),
      secondary: this.normalizeSeriesToPercentChange(visibleAligned.secondary),
    };
  }

  private alignSeriesWithStepHold(
    primarySeries: DataPoint[],
    secondarySeries: DataPoint[]
  ): { primary: ChartPoint[]; secondary: ChartPoint[] } {
    const allTimestamps = new Set<number>();

    for (const point of primarySeries) {
      allTimestamps.add(point.date.getTime());
    }

    for (const point of secondarySeries) {
      allTimestamps.add(point.date.getTime());
    }

    const sortedTimestamps = Array.from(allTimestamps.values()).sort((a, b) => a - b);

    const alignedPrimary: ChartPoint[] = [];
    const alignedSecondary: ChartPoint[] = [];

    let primaryIndex = 0;
    let secondaryIndex = 0;
    let latestPrimary: number | null = null;
    let latestSecondary: number | null = null;

    for (const timestamp of sortedTimestamps) {
      while (
        primaryIndex < primarySeries.length &&
        primarySeries[primaryIndex].date.getTime() <= timestamp
      ) {
        latestPrimary = primarySeries[primaryIndex].value;
        primaryIndex += 1;
      }

      while (
        secondaryIndex < secondarySeries.length &&
        secondarySeries[secondaryIndex].date.getTime() <= timestamp
      ) {
        latestSecondary = secondarySeries[secondaryIndex].value;
        secondaryIndex += 1;
      }

      const date = new Date(timestamp);
      alignedPrimary.push({ date, value: latestPrimary });
      alignedSecondary.push({ date, value: latestSecondary });
    }

    return { primary: alignedPrimary, secondary: alignedSecondary };
  }

  private normalizeSeriesToPercentChange(series: ChartPoint[]): ChartPoint[] {
    const basePoint = series.find(
      (point) => point.value != null && Number.isFinite(point.value)
    );
    const baseValue = basePoint?.value;

    if (!Number.isFinite(baseValue) || baseValue === 0) {
      return series.map((point) => ({ date: point.date, value: null }));
    }

    return series.map((point) => {
      if (point.value == null || !Number.isFinite(point.value)) {
        return { date: point.date, value: null };
      }

      const normalized = ((point.value / baseValue) - 1) * 100;

      return {
        date: point.date,
        value: Number.isFinite(normalized) ? normalized : null,
      };
    });
  }

  private filterAlignedSeriesByRange(
    primary: ChartPoint[],
    secondary: ChartPoint[],
    range: TimeRange
  ): { primary: ChartPoint[]; secondary: ChartPoint[] } {
    if (!primary.length || !secondary.length) {
      return { primary: [], secondary: [] };
    }

    if (range === 'max') {
      return { primary, secondary };
    }

    const latest = primary[primary.length - 1].date.getTime();
    const days = this.rangePolicy.mapRangeToDays(range);
    const cutoff = latest - days * 24 * 60 * 60 * 1000;

    const firstVisibleIndex = primary.findIndex((point) => point.date.getTime() >= cutoff);
    if (firstVisibleIndex === -1) {
      return {
        primary: primary.slice(-1),
        secondary: secondary.slice(-1),
      };
    }

    return {
      primary: primary.slice(firstVisibleIndex),
      secondary: secondary.slice(firstVisibleIndex),
    };
  }
}
