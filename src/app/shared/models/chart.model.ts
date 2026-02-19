export interface ChartPoint {
  date: Date;
  value: number | null;
}

export interface ChartLine {
  assetId: string;
  assetName: string;
  color: string;
  strokeStyle: 'solid' | 'dashed';
  points: ChartPoint[];
}
