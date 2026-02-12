// import { Component, inject, OnInit } from '@angular/core';
// import { MarketService } from './core/services/market.service';
// import { MarketChartComponent } from './components/market-chart/market-chart.component';
// import { MarketAsset } from './shared/models/market.model';

// @Component({
//   selector: 'app-root',
//   standalone: true,
//   imports: [MarketChartComponent],
//   template: `
//     <main style="padding: 20px; background: #121212; min-height: 100vh; color: white;">
//       <h1>Market Visualizer</h1>

//       <div style="margin-bottom: 20px; display: flex; gap: 10px;">
//         @for (asset of assets; track asset.id) {
//           <button (click)="selectAsset(asset)"
//                   [style.border-color]="asset.color"
//                   style="padding: 8px 16px; background: #1e1e1e; color: white; cursor: pointer; border: 2px solid transparent; border-radius: 6px;">
//             {{ asset.name }}
//           </button>
//         }
//       </div>

//       <app-market-chart></app-market-chart>
//     </main>
//   `
// })
// export class AppComponent implements OnInit {
//   marketService = inject(MarketService);
//   assets: MarketAsset[] = [];

//   ngOnInit() {
//     this.assets = this.marketService.loadAssets();
//     this.selectAsset(this.assets[0]); // Default to Bitcoin
//   }

//   selectAsset(asset: MarketAsset) {
//     this.marketService.selectedAsset.set(asset);
//   }
// }
