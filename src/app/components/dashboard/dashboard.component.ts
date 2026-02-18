import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MarketService } from '../../core/services/market.service';
import { MarketChartComponent } from '../market-chart/market-chart.component';
import { MarketAsset } from '../../shared/models/market.model';

type ThemeMode = 'light' | 'dark';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, MarketChartComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
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
