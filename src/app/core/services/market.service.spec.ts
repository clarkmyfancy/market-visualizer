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
});

function getAssetById(service: MarketService, assetId: string) {
  const asset = service.getAssets().find((candidate) => candidate.id === assetId);
  if (!asset) {
    throw new Error(`Asset "${assetId}" not found in test setup.`);
  }
  return asset;
}
