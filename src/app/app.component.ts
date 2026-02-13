import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MarketService } from './core/services/market.service';
import { MarketChartComponent } from './components/market-chart/market-chart.component';
import { MarketAsset } from './shared/models/market.model';

type ThemeMode = 'light' | 'dark';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MarketChartComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  readonly marketService = inject(MarketService);

  assets: MarketAsset[] = [];

  readonly theme = signal<ThemeMode>(this.loadTheme());
  readonly themeClass = computed(() => (this.theme() === 'dark' ? 'theme-dark' : 'theme-light'));

  ngOnInit(): void {
    this.assets = this.marketService.getAssets();
    if (this.assets.length > 0) this.selectAsset(this.assets[0]);
  }

  selectAsset(asset: MarketAsset): void {
    this.marketService.selectAsset(asset);
  }

  toggleTheme(): void {
    const next: ThemeMode = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    this.saveTheme(next);
  }

  private loadTheme(): ThemeMode {
    try {
      const v = localStorage.getItem('theme');
      return v === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  private saveTheme(mode: ThemeMode): void {
    try {
      localStorage.setItem('theme', mode);
    } catch {
      // ignore
    }
  }
}
