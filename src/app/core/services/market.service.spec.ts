import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';

import { DataPoint, TimeRange } from '../../shared/models/market.model';
import { MarketService } from './market.service';
import { AustinHousingDataService } from './data/austin-housing-data.service';
import { CryptoMarketDataService } from './data/crypto-market-data.service';

type HousingResult = { points: DataPoint[]; metricLabel: string };
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

class MockCryptoMarketDataService {
  readonly calls: Array<{ coinId: string; range: TimeRange; stream: Subject<DataPoint[]> }> = [];

  readonly loadSeries = jest.fn((coinId: string, range: TimeRange): Observable<DataPoint[]> => {
    const stream = new Subject<DataPoint[]>();
    this.calls.push({ coinId, range, stream });
    return stream.asObservable();
  });
}

class MockAustinHousingDataService {
  readonly calls: Array<{ range: TimeRange; deferred: Deferred<HousingResult> }> = [];

  readonly loadSeries = jest.fn((range: TimeRange): Promise<HousingResult> => {
    const deferred = createDeferred<HousingResult>();
    this.calls.push({ range, deferred });
    return deferred.promise;
  });
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function makePoint(day: number, value: number): DataPoint {
  return { date: new Date(Date.UTC(2024, 0, day)), value };
}

describe('MarketService', () => {
  let service: MarketService;
  let cryptoData: MockCryptoMarketDataService;
  let housingData: MockAustinHousingDataService;

  beforeEach(() => {
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('month');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);

    cryptoData = new MockCryptoMarketDataService();
    housingData = new MockAustinHousingDataService();

    TestBed.configureTestingModule({
      providers: [
        MarketService,
        { provide: CryptoMarketDataService, useValue: cryptoData },
        { provide: AustinHousingDataService, useValue: housingData },
      ],
    });

    service = TestBed.inject(MarketService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps loading true until the latest crypto request completes', () => {
    const bitcoin = getAssetById(service, 'bitcoin');

    service.selectAsset(bitcoin);
    const first = cryptoData.calls[0];

    service.setRange('year');
    const second = cryptoData.calls[1];

    first.stream.next([makePoint(1, 100)]);
    first.stream.complete();

    expect(service.isLoading()).toBe(true);
    expect(service.series()).toEqual([]);

    second.stream.next([makePoint(2, 200)]);
    second.stream.complete();

    expect(service.isLoading()).toBe(false);
    expect(service.series().length).toBe(1);
    expect(service.series()[0].value).toBe(200);
    expect(service.error()).toBeNull();
  });

  it('ignores stale errors from an outdated request', () => {
    const bitcoin = getAssetById(service, 'bitcoin');

    service.selectAsset(bitcoin);
    const first = cryptoData.calls[0];

    service.setRange('year');
    const second = cryptoData.calls[1];

    first.stream.error(
      new HttpErrorResponse({
        status: 429,
        statusText: 'Too Many Requests',
        url: '/api/coingecko/coins/bitcoin/market_chart',
      })
    );

    expect(service.error()).toBeNull();
    expect(service.isLoading()).toBe(true);

    second.stream.next([makePoint(3, 300)]);
    second.stream.complete();

    expect(service.error()).toBeNull();
    expect(service.isLoading()).toBe(false);
    expect(service.series().length).toBe(1);
    expect(service.series()[0].value).toBe(300);
  });

  it('clears stale error when serving cached data', () => {
    const bitcoin = getAssetById(service, 'bitcoin');

    service.selectAsset(bitcoin);
    const monthRequest = cryptoData.calls[0];
    monthRequest.stream.next([makePoint(4, 400)]);
    monthRequest.stream.complete();

    service.setRange('year');
    const yearRequest = cryptoData.calls[1];
    yearRequest.stream.error(
      new HttpErrorResponse({
        status: 429,
        statusText: 'Too Many Requests',
        url: '/api/coingecko/coins/bitcoin/market_chart',
      })
    );

    expect(service.error()).toBe('CoinGecko rate limit hit (429).');
    expect(service.isLoading()).toBe(false);

    service.setRange('month');

    expect(cryptoData.calls.length).toBe(2);
    expect(service.series().length).toBe(1);
    expect(service.series()[0].value).toBe(400);
    expect(service.error()).toBeNull();
    expect(service.isLoading()).toBe(false);
  });

  it('ignores stale housing results after switching assets', async () => {
    const austin = getAssetById(service, 'austin-real-estate');
    const bitcoin = getAssetById(service, 'bitcoin');

    service.selectAsset(austin);
    const housingRequest = housingData.calls[0];
    expect(housingRequest.range).toBe('3m');

    service.selectAsset(bitcoin);
    const cryptoRequest = cryptoData.calls[0];

    housingRequest.deferred.resolve({
      points: [makePoint(5, 500000)],
      metricLabel: 'Median Listing Price',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.series()).toEqual([]);
    expect(service.austinMetricLabel()).toBe('Median Sale Price');
    expect(service.isLoading()).toBe(true);

    cryptoRequest.stream.next([makePoint(6, 600)]);
    cryptoRequest.stream.complete();

    expect(service.isLoading()).toBe(false);
    expect(service.series().length).toBe(1);
    expect(service.series()[0].value).toBe(600);
  });

  it('chooses a default secondary asset and avoids primary/secondary collisions', () => {
    const bitcoin = getAssetById(service, 'bitcoin');
    const ethereum = getAssetById(service, 'ethereum');

    service.selectAsset(bitcoin);
    const bitcoinMonthRequest = getLastCryptoCall(cryptoData, 'bitcoin', 'month');
    bitcoinMonthRequest.stream.next([makePoint(1, 100)]);
    bitcoinMonthRequest.stream.complete();

    service.setCompareEnabled(true);

    expect(service.secondaryAssetId()).toBe('ethereum');

    const bitcoinYearRequest = getLastCryptoCall(cryptoData, 'bitcoin', 'year');
    const ethereumYearRequest = getLastCryptoCall(cryptoData, 'ethereum', 'year');
    bitcoinYearRequest.stream.next([makePoint(1, 100)]);
    bitcoinYearRequest.stream.complete();
    ethereumYearRequest.stream.next([makePoint(1, 200)]);
    ethereumYearRequest.stream.complete();

    service.setSecondaryAsset(bitcoin.id);
    expect(service.secondaryAssetId()).toBe('ethereum');

    service.selectAsset(ethereum);
    const ethereumMonthRequest = getLastCryptoCall(cryptoData, 'ethereum', 'month');
    ethereumMonthRequest.stream.next([makePoint(2, 200)]);
    ethereumMonthRequest.stream.complete();

    const housingMaxRequest = getLastHousingCall(housingData, 'max');
    housingMaxRequest.deferred.resolve({
      points: [makePoint(3, 500000)],
      metricLabel: 'Median Listing Price',
    });

    expect(service.secondaryAssetId()).toBe('austin-real-estate');
  });

  it('aligns compare series with step-hold and keeps normalization base at dataset start', async () => {
    const bitcoin = getAssetById(service, 'bitcoin');

    service.selectAsset(bitcoin);
    const bitcoinMonthRequest = getLastCryptoCall(cryptoData, 'bitcoin', 'month');
    bitcoinMonthRequest.stream.next([makePoint(20, 20)]);
    bitcoinMonthRequest.stream.complete();

    service.setCompareEnabled(true);

    const bitcoinYearRequest = getLastCryptoCall(cryptoData, 'bitcoin', 'year');
    const ethereumYearRequest = getLastCryptoCall(cryptoData, 'ethereum', 'year');

    bitcoinYearRequest.stream.next([makePoint(1, 10), makePoint(20, 20)]);
    bitcoinYearRequest.stream.complete();

    ethereumYearRequest.stream.next([makePoint(2, 5), makePoint(20, 10)]);
    ethereumYearRequest.stream.complete();

    await Promise.resolve();
    await Promise.resolve();

    const indexLines = service.chartLines();
    expect(indexLines).toHaveLength(2);
    expect(indexLines[0].points.map((point) => point.value)).toEqual([100, 100, 200]);
    expect(indexLines[1].points.map((point) => point.value)).toEqual([null, 100, 200]);

    service.setNormalizeMode('pct');
    const pctLines = service.chartLines();
    expect(pctLines[0].points.map((point) => point.value)).toEqual([0, 0, 100]);
    expect(pctLines[1].points.map((point) => point.value)).toEqual([null, 0, 100]);

    service.setRange('week');
    const bitcoinWeekRequest = getLastCryptoCall(cryptoData, 'bitcoin', 'week');
    bitcoinWeekRequest.stream.next([makePoint(20, 20)]);
    bitcoinWeekRequest.stream.complete();

    const weekLines = service.chartLines();
    expect(weekLines[0].points.map((point) => point.value)).toEqual([100]);
    expect(weekLines[1].points.map((point) => point.value)).toEqual([100]);
  });

  it('hides 2Y/5Y/Max and coerces blocked ranges when compare includes crypto', () => {
    const bitcoin = getAssetById(service, 'bitcoin');

    service.selectAsset(bitcoin);
    const monthRequest = getLastCryptoCall(cryptoData, 'bitcoin', 'month');
    monthRequest.stream.next([makePoint(1, 100)]);
    monthRequest.stream.complete();

    expect(service.getVisibleRangeOptions().map((option) => option.value)).toEqual([
      'week',
      'month',
      '3m',
      '6m',
      'year',
      '2y',
      '5y',
      'max',
    ]);

    service.setRange('max');
    const maxRequest = getLastCryptoCall(cryptoData, 'bitcoin', 'max');
    maxRequest.stream.next([makePoint(2, 110)]);
    maxRequest.stream.complete();
    expect(service.range()).toBe('max');

    service.setCompareEnabled(true);

    const yearCalls = cryptoData.calls.filter((call) => call.range === 'year');
    expect(yearCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of yearCalls) {
      const value = call.coinId === 'ethereum' ? 210 : 120;
      call.stream.next([makePoint(3, value)]);
      call.stream.complete();
    }

    expect(service.range()).toBe('year');
    expect(service.getVisibleRangeOptions().map((option) => option.value)).toEqual([
      'week',
      'month',
      '3m',
      '6m',
      'year',
    ]);

    const maxCallCountBeforeBlockedSet = cryptoData.calls.filter((call) => call.range === 'max').length;
    service.setRange('max');
    expect(service.range()).toBe('year');
    const latestCall = cryptoData.calls[cryptoData.calls.length - 1];
    expect(latestCall.range).toBe('year');
    const maxCallCountAfterBlockedSet = cryptoData.calls.filter((call) => call.range === 'max').length;
    expect(maxCallCountAfterBlockedSet).toBe(maxCallCountBeforeBlockedSet);
  });
});

function getAssetById(service: MarketService, assetId: string) {
  const asset = service.getAssets().find((candidate) => candidate.id === assetId);
  if (!asset) {
    throw new Error(`Asset "${assetId}" not found in test setup.`);
  }
  return asset;
}

function getLastCryptoCall(
  cryptoData: MockCryptoMarketDataService,
  coinId: string,
  range: TimeRange
) {
  const calls = cryptoData.calls.filter((call) => call.coinId === coinId && call.range === range);
  const match = calls[calls.length - 1];
  if (!match) {
    throw new Error(`Expected crypto call for coin "${coinId}" and range "${range}".`);
  }
  return match;
}

function getLastHousingCall(
  housingData: MockAustinHousingDataService,
  range: TimeRange
) {
  const calls = housingData.calls.filter((call) => call.range === range);
  const match = calls[calls.length - 1];
  if (!match) {
    throw new Error(`Expected housing call for range "${range}".`);
  }
  return match;
}
