export type AssetCategory = 'crypto' | 'stock' | 'real-estate';

export interface DataPoint {
  date: Date;
  value: number;
}

export interface MarketAsset {
  id: string;
  name: string;
  category: AssetCategory;
  color: string;
}

export interface CoinGeckoMarketChartResponse {
  prices: [number, number][];
  market_caps: [number, number][];
  total_volumes: [number, number][];
}
