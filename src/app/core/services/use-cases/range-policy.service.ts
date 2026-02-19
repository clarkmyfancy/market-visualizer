import { Injectable } from '@angular/core';

import { DataPoint, MarketAsset, TimeRange } from '../../../shared/models/market.model';

@Injectable({ providedIn: 'root' })
export class RangePolicyService {
  private readonly rangeOptions: { value: TimeRange; label: string }[] = [
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: '3m', label: '3M' },
    { value: '6m', label: '6M' },
    { value: 'year', label: 'Year' },
    { value: '2y', label: '2Y' },
    { value: '5y', label: '5Y' },
    { value: 'max', label: 'Max' },
  ];
  private readonly compareCryptoBlockedRanges = new Set<TimeRange>(['2y', '5y', 'max']);
  private readonly cryptoBlockedRanges = new Set<TimeRange>(['2y', '5y', 'max']);

  getRangeOptions(): { value: TimeRange; label: string }[] {
    return this.rangeOptions;
  }

  getVisibleRangeOptions(
    compareEnabled: boolean,
    primaryAsset: MarketAsset | null,
    secondaryAsset: MarketAsset | null
  ): { value: TimeRange; label: string }[] {
    if (!this.shouldLimitRangesForCryptoCompare(compareEnabled, primaryAsset, secondaryAsset)) {
      return this.rangeOptions;
    }

    return this.rangeOptions.filter((option) => !this.compareCryptoBlockedRanges.has(option.value));
  }

  normalizeRangeForAsset(asset: MarketAsset, range: TimeRange): TimeRange {
    if (asset.id === 'austin-real-estate' && (range === 'week' || range === 'month')) {
      return '3m';
    }

    if (asset.category === 'crypto' && this.cryptoBlockedRanges.has(range)) {
      return 'year';
    }

    return range;
  }

  normalizeRangeForContext(
    compareEnabled: boolean,
    primaryAsset: MarketAsset,
    secondaryAsset: MarketAsset | null,
    range: TimeRange
  ): TimeRange {
    const assetAdjusted = this.normalizeRangeForAsset(primaryAsset, range);

    if (
      this.shouldLimitRangesForCryptoCompare(compareEnabled, primaryAsset, secondaryAsset) &&
      this.compareCryptoBlockedRanges.has(assetAdjusted)
    ) {
      return 'year';
    }

    return assetAdjusted;
  }

  mapRangeToDays(range: TimeRange): number {
    switch (range) {
      case 'week':
        return 7;
      case 'month':
        return 30;
      case '3m':
        return 90;
      case '6m':
        return 180;
      case 'year':
        return 365;
      case '2y':
        return 365 * 2;
      case '5y':
        return 365 * 5;
      case 'max':
      default:
        return Number.MAX_SAFE_INTEGER;
    }
  }

  filterSeriesByRange(series: DataPoint[], range: TimeRange): DataPoint[] {
    if (!series.length) return [];
    if (range === 'max') return series;

    const latest = series[series.length - 1]?.date.getTime();
    if (!latest) return series;

    const days = this.mapRangeToDays(range);
    const cutoff = latest - days * 24 * 60 * 60 * 1000;

    const filtered = series.filter((point) => point.date.getTime() >= cutoff);
    return filtered.length > 0 ? filtered : series.slice(-1);
  }

  private shouldLimitRangesForCryptoCompare(
    compareEnabled: boolean,
    primaryAsset: MarketAsset | null,
    secondaryAsset: MarketAsset | null
  ): boolean {
    if (!compareEnabled) return false;
    if (!primaryAsset) return false;
    if (primaryAsset.category === 'crypto') return true;

    return secondaryAsset?.category === 'crypto';
  }
}
