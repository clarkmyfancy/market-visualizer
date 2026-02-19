import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MarketService } from '../../core/services/market.service';
import { MarketChartComponent } from '../market-chart/market-chart.component';
import { MarketAsset } from '../../shared/models/market.model';

type ThemeMode = 'light' | 'dark';
type ExperimentMode = 'core' | 'signal-lens';

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
  readonly experimentMode = signal<ExperimentMode>(this.loadExperimentMode());

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

  setExperimentMode(value: string): void {
    const allowed: ExperimentMode[] = ['core', 'signal-lens'];
    if (!allowed.includes(value as ExperimentMode)) return;

    const mode = value as ExperimentMode;
    this.experimentMode.set(mode);
    this.saveExperimentMode(mode);
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

  private loadExperimentMode(): ExperimentMode {
    try {
      const value = localStorage.getItem('experiment-mode');
      if (value === 'signal-lens' || value === 'experiment-1') return 'signal-lens';
      return 'core';
    } catch {
      return 'core';
    }
  }

  private saveExperimentMode(mode: ExperimentMode): void {
    try {
      localStorage.setItem('experiment-mode', mode);
    } catch {
      // ignore
    }
  }
}
