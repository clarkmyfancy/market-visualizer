import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { MarketService } from '../../core/services/market.service';
import { TimeRange } from '../../shared/models/market.model';
import {
  PATTERN_TYPE_OPTIONS,
  detectPatternSignals,
  toAnalysisSeries,
  type PatternSensitivity,
  type PatternSignal,
  type PatternSignalType,
  type PatternSortMode,
  type PatternTypeOption,
} from './pattern-detector';
import {
  renderMarketChart,
  type HoverInfo,
  type HoverSeriesPoint,
  type RenderMode,
  type ThemeTokens,
} from './market-chart-renderer';

type ExperimentMode = 'core' | 'signal-lens';
type RiskFeatureKey = 'mean' | 'stress' | 'drawdown';

type PatternFeedItem = PatternSignal & {
  hiddenOnChart: boolean;
};

type RiskTipCard = {
  key: RiskFeatureKey;
  title: string;
  summary: string;
  whatItIs: string;
  bullets: string[];
  commonMistake?: string;
};

@Component({
  selector: 'app-market-chart',
  standalone: true,
  templateUrl: './market-chart.component.html',
  styleUrls: ['./market-chart.component.scss'],
})
export class MarketChartComponent implements AfterViewInit, OnDestroy {
  @ViewChild('chartContainer', { static: true })
  chartContainer!: ElementRef<HTMLDivElement>;
  @Input() set experimentMode(mode: ExperimentMode | null | undefined) {
    const nextMode: ExperimentMode = mode === 'signal-lens' ? 'signal-lens' : 'core';
    this.currentExperimentMode.set(nextMode);
    this.patternsEnabled.set(nextMode === 'signal-lens');
    this.selectedPatternSignalId.set(null);
  }

  readonly marketService = inject(MarketService);
  readonly isSignalLensEnabled = computed(() => this.currentExperimentMode() === 'signal-lens');

  readonly ranges = computed(() => this.marketService.getVisibleRangeOptions());
  readonly compareAssetOptions = computed(() => this.marketService.getCompareAssetOptions());
  readonly chartLines = this.marketService.chartLines;
  readonly patternTypeOptions: PatternTypeOption[] = PATTERN_TYPE_OPTIONS;

  private readonly usdFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
  private readonly hoverDateFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  private readonly hoverPctFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  });
  private readonly hoverPriceFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
  private readonly drawdownFormatter = new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  });

  private readonly viewReady = signal(false);
  private readonly currentExperimentMode = signal<ExperimentMode>('core');
  readonly hoverInfo = signal<HoverInfo | null>(null);
  readonly patternsEnabled = signal(false);
  readonly patternSensitivity = signal<PatternSensitivity>('normal');
  readonly patternSortMode = signal<PatternSortMode>('recency');
  readonly showOnlyStrongestPatternSignals = signal(false);
  readonly selectedPatternTypes = signal<PatternSignalType[]>([
    'momentum',
    'meanReversion',
    'volatility',
    'trend',
    'pattern',
  ]);
  readonly selectedPatternSignalId = signal<string | null>(null);
  readonly riskLensEnabled = signal(true);
  readonly showMeanBands = signal(true);
  readonly showStressMarkers = signal(true);
  readonly showDrawdown = signal(true);
  readonly riskHelpMenuOpen = signal(false);
  readonly activeRiskTipKey = signal<RiskFeatureKey | null>(null);
  readonly activeRiskTipCard = computed<RiskTipCard | null>(() => {
    const key = this.activeRiskTipKey();
    if (!key) return null;
    return this.riskTipCards.find((card) => card.key === key) ?? null;
  });
  readonly riskTipCards: RiskTipCard[] = [
    {
      key: 'mean',
      title: 'Mean-reversion bands',
      summary: 'Rolling average with upper/lower variability bands.',
      whatItIs: 'A rolling average with an upper and lower band based on recent variability (standard deviation).',
      bullets: [
        'The middle line is the recent "typical" level (rolling mean).',
        'Bands widen when the series gets more volatile and tighten when it calms down.',
        'Values outside the bands indicate an unusually large deviation relative to the recent window.',
      ],
      commonMistake: 'Treating band breaks as guaranteed reversals; they are a context signal, not a prediction.',
    },
    {
      key: 'stress',
      title: 'Stress markers',
      summary: 'Flags for unusually large negative point-to-point moves.',
      whatItIs: 'Flags for unusually large negative moves between consecutive points.',
      bullets: [
        'Each marker highlights a sharp drop versus the prior point.',
        'Clusters of markers typically indicate turbulent periods.',
        'Use them to locate "panic" zones quickly, then inspect what happened around them.',
      ],
      commonMistake: 'Over-weighting single markers; one sharp move can be noise and patterns matter more.',
    },
    {
      key: 'drawdown',
      title: 'Drawdown from high / Drawup from low',
      summary: 'Signed percent move versus running peak/trough over time.',
      whatItIs:
        'Negative values are drawdown from the running peak, while positive values are drawup from the running trough.',
      bullets: [
        'Below 0%: how far the series sits under its running peak.',
        'Above 0%: how far the series sits above its running trough.',
        'Use it to compare downside stress and upside recovery in the same range.',
      ],
      commonMistake:
        'Reading a positive value as "risk-free"; drawup can reverse quickly in volatile windows.',
    },
  ];

  readonly detectedPatternSignals = computed<PatternSignal[]>(() => {
    if (!this.isSignalLensEnabled() || !this.patternsEnabled()) return [];

    const primarySeries = this.chartLines()[0]?.points ?? [];
    const analysisSeries = toAnalysisSeries(primarySeries);

    if (analysisSeries.length < 6) return [];

    return detectPatternSignals(analysisSeries, this.patternSensitivity());
  });

  readonly filteredPatternSignals = computed<PatternSignal[]>(() => {
    if (!this.isSignalLensEnabled() || !this.patternsEnabled()) return [];

    const selected = new Set(this.selectedPatternTypes());
    return this.detectedPatternSignals().filter((signal) => selected.has(signal.type));
  });

  readonly chartAnnotationSignals = computed<PatternSignal[]>(() => {
    const top = [...this.filteredPatternSignals()]
      .sort((a, b) => b.strength - a.strength || b.date.getTime() - a.date.getTime())
      .slice(0, 10);

    return top;
  });

  readonly patternFeedSignals = computed<PatternFeedItem[]>(() => {
    if (!this.isSignalLensEnabled() || !this.patternsEnabled()) return [];

    const sorted = this.sortPatternSignals(this.filteredPatternSignals(), this.patternSortMode());
    const chartIds = new Set(this.chartAnnotationSignals().map((signal) => signal.id));
    const feed = sorted.map((signal) => ({
      ...signal,
      hiddenOnChart: !chartIds.has(signal.id),
    }));

    if (this.showOnlyStrongestPatternSignals()) {
      return feed.filter((signal) => !signal.hiddenOnChart);
    }

    return feed;
  });

  readonly hiddenPatternSignalCount = computed<number>(() => {
    if (!this.isSignalLensEnabled() || !this.patternsEnabled()) return 0;
    if (this.showOnlyStrongestPatternSignals()) return 0;

    return this.filteredPatternSignals().length - this.chartAnnotationSignals().length;
  });
  private resizeObserver?: ResizeObserver;

  private themeObserver?: MutationObserver;
  private mediaQueryList?: MediaQueryList;
  private queuedThemeRerender = false;

  private readonly renderEffect = effect(() => {
    if (!this.viewReady()) return;

    const lines = this.chartLines();
    const mode = this.currentRenderMode();
    const patternsEnabled = this.patternsEnabled();
    const experimentMode = this.currentExperimentMode();
    void experimentMode;
    const selectedTypes = this.selectedPatternTypes();
    const sensitivity = this.patternSensitivity();
    const sortMode = this.patternSortMode();
    const strongestOnly = this.showOnlyStrongestPatternSignals();
    const selectedSignal = this.selectedPatternSignalId();
    const lensEnabled = this.riskLensEnabled();
    const meanBands = this.showMeanBands();
    const stressMarkers = this.showStressMarkers();
    const drawdown = this.showDrawdown();
    void patternsEnabled;
    void selectedTypes;
    void sensitivity;
    void sortMode;
    void strongestOnly;
    void selectedSignal;
    void lensEnabled;
    void meanBands;
    void stressMarkers;
    void drawdown;

    this.render(lines, mode);
  }, { allowSignalWrites: true });

  private readonly selectedSignalGuardEffect = effect(() => {
    const selectedId = this.selectedPatternSignalId();
    if (!selectedId) return;

    const feedIds = new Set(this.patternFeedSignals().map((signal) => signal.id));
    if (!feedIds.has(selectedId)) {
      this.selectedPatternSignalId.set(null);
    }
  }, { allowSignalWrites: true });

  ngAfterViewInit(): void {
    this.viewReady.set(true);

    this.resizeObserver = new ResizeObserver(() => {
      const lines = untracked(() => this.chartLines());
      const mode = untracked(() => this.currentRenderMode());
      this.render(lines, mode);
    });

    this.resizeObserver.observe(this.chartContainer.nativeElement);

    this.installThemeObservers();
    this.requestThemeRerender();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();

    if (this.mediaQueryList) {
      try {
        this.mediaQueryList.removeEventListener('change', this.onSystemThemeChange);
      } catch {
        this.mediaQueryList.removeListener?.(this.onSystemThemeChange);
      }
    }
  }

  setRange(r: TimeRange): void {
    if (this.isRangeDisabled(r)) return;
    this.marketService.setRange(r);
  }

  setCompareEnabled(enabled: boolean): void {
    this.marketService.setCompareEnabled(enabled);
  }

  setSecondaryAsset(assetId: string): void {
    this.marketService.setSecondaryAsset(assetId);
  }

  setMeanBandsEnabled(enabled: boolean): void {
    this.showMeanBands.set(enabled);
  }

  setStressMarkersEnabled(enabled: boolean): void {
    this.showStressMarkers.set(enabled);
  }

  setDrawdownEnabled(enabled: boolean): void {
    this.showDrawdown.set(enabled);
  }

  toggleRiskHelpMenu(): void {
    this.riskHelpMenuOpen.set(!this.riskHelpMenuOpen());
  }

  closeRiskHelpMenu(): void {
    this.riskHelpMenuOpen.set(false);
  }

  openRiskHelpModal(feature: RiskFeatureKey): void {
    this.activeRiskTipKey.set(feature);
    this.riskHelpMenuOpen.set(false);
  }

  closeRiskHelpModal(): void {
    this.activeRiskTipKey.set(null);
  }

  isRangeDisabled(r: TimeRange): boolean {
    const asset = this.marketService.selectedAsset();
    if (asset?.id !== 'austin-real-estate') return false;
    return r === 'week' || r === 'month';
  }

  headerLabel(): string {
    if (this.marketService.compareEnabled()) return 'Compare';

    const asset = this.marketService.selectedAsset();
    if (asset?.id === 'austin-real-estate') return this.marketService.austinMetricLabel();
    return 'Asset';
  }

  headerValue(): string {
    const asset = this.marketService.selectedAsset();
    if (!asset) return '—';

    if (this.marketService.compareEnabled()) {
      const secondary = this.marketService.getSecondaryAsset();
      return secondary ? `${asset.name} vs ${secondary.name}` : asset.name;
    }

    if (asset.id !== 'austin-real-estate') {
      return asset.name;
    }

    const latest = this.marketService.latestPoint();
    if (!latest) return '—';

    return this.usdFormatter.format(latest.value);
  }

  hoverDateLabel(): string {
    const info = this.hoverInfo();
    if (!info) return '';
    return this.hoverDateFormatter.format(info.date);
  }

  hoverSeries(): HoverSeriesPoint[] {
    return this.hoverInfo()?.series ?? [];
  }

  formatHoverValue(value: number | null, mode: RenderMode): string {
    if (value == null || !Number.isFinite(value)) return '—';
    if (mode === 'price') {
      return this.hoverPriceFormatter.format(value);
    }
    return `${this.hoverPctFormatter.format(value)}%`;
  }

  formatHoverRisk(direction: 'drawdown' | 'drawup', value: number): string {
    if (!Number.isFinite(value)) return '—';
    const label = direction === 'drawdown' ? 'Drawdown' : 'Drawup';
    return `${label} ${this.drawdownFormatter.format(value)}`;
  }

  isPatternTypeSelected(type: PatternSignalType): boolean {
    return this.selectedPatternTypes().includes(type);
  }

  togglePatternType(type: PatternSignalType): void {
    const selected = this.selectedPatternTypes();
    if (selected.includes(type)) {
      this.selectedPatternTypes.set(selected.filter((entry) => entry !== type));
      return;
    }

    this.selectedPatternTypes.set([...selected, type]);
  }

  setPatternSensitivity(value: string): void {
    const valid: PatternSensitivity[] = ['conservative', 'normal', 'sensitive'];
    if (!valid.includes(value as PatternSensitivity)) return;
    this.patternSensitivity.set(value as PatternSensitivity);
  }

  setPatternSortMode(value: string): void {
    const valid: PatternSortMode[] = ['recency', 'strength'];
    if (!valid.includes(value as PatternSortMode)) return;
    this.patternSortMode.set(value as PatternSortMode);
  }

  setShowOnlyStrongestPatternSignals(enabled: boolean): void {
    this.showOnlyStrongestPatternSignals.set(enabled);
  }

  focusPatternSignal(signalId: string): void {
    this.selectedPatternSignalId.set(signalId);
    this.chartContainer.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  formatPatternSignalDate(signal: PatternSignal): string {
    if (signal.startDate && signal.endDate) {
      return `${this.hoverDateFormatter.format(signal.startDate)} - ${this.hoverDateFormatter.format(signal.endDate)}`;
    }

    return this.hoverDateFormatter.format(signal.date);
  }

  formatPatternSignalStrength(signal: PatternSignal): string {
    const score = Math.round(signal.strength);
    if (score >= 75) return `${score}/100 (High)`;
    if (score >= 45) return `${score}/100 (Medium)`;
    return `${score}/100 (Low)`;
  }

  formatPatternDirection(signal: PatternSignal): string {
    if (signal.direction === 'bullish') return 'Bullish';
    if (signal.direction === 'bearish') return 'Bearish';
    return 'Neutral';
  }

  formatPatternType(signalType: PatternSignalType): string {
    const option = this.patternTypeOptions.find((entry) => entry.key === signalType);
    return option?.label ?? signalType;
  }

  isRiskFeatureVisible(feature: RiskFeatureKey): boolean {
    if (!this.riskLensEnabled()) return false;
    if (feature === 'mean') return this.showMeanBands();
    if (feature === 'stress') return this.showStressMarkers();
    return this.showDrawdown();
  }

  private currentRenderMode(): RenderMode {
    return this.marketService.compareEnabled() ? 'pct' : 'price';
  }

  private installThemeObservers(): void {
    const host = this.chartContainer.nativeElement;
    const dash = host.closest('.dashboard-container') as HTMLElement | null;
    const target = dash ?? document.documentElement;

    this.themeObserver = new MutationObserver(() => {
      this.requestThemeRerender();
    });

    this.themeObserver.observe(target, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    this.mediaQueryList = window.matchMedia?.('(prefers-color-scheme: dark)') ?? undefined;
    if (this.mediaQueryList) {
      try {
        this.mediaQueryList.addEventListener('change', this.onSystemThemeChange);
      } catch {
        this.mediaQueryList.addListener?.(this.onSystemThemeChange);
      }
    }
  }

  private readonly onSystemThemeChange = () => {
    this.requestThemeRerender();
  };

  private requestThemeRerender(): void {
    if (this.queuedThemeRerender) return;
    this.queuedThemeRerender = true;

    requestAnimationFrame(() => {
      this.queuedThemeRerender = false;

      const lines = untracked(() => this.chartLines());
      const mode = untracked(() => this.currentRenderMode());

      if (!lines || lines.length === 0) return;

      this.render(lines, mode);
    });
  }

  private readThemeTokens(): ThemeTokens {
    const el = this.chartContainer.nativeElement;
    const cs = getComputedStyle(el);

    const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;

    const ink = get('--ink', '#000');
    const axis = get('--chart-axis', get('--border-mid', '#666'));
    const grid = get('--chart-grid', 'rgba(0,0,0,0.2)');
    const chartBg = get('--chart-bg', get('--inset', '#dedede'));
    const chartText = get('--chart-text', get('--text', '#111'));
    const chartMuted = get('--chart-muted', get('--muted', '#444'));
    const patternMomentum = get('--pattern-momentum-color', '#1e63d8');
    const patternMeanReversion = get('--pattern-mean-reversion-color', '#0f8d7a');
    const patternVolatility = get('--pattern-volatility-color', '#c86a06');
    const patternTrend = get('--pattern-trend-color', '#8a3fd0');
    const patternPattern = get('--pattern-pattern-color', '#6f6f6f');
    const patternHighlight = get('--pattern-highlight-color', '#111111');
    const riskMean = get('--risk-mean-color', '#0f8d7a');
    const riskStress = get('--risk-stress-color', '#cf3f32');
    const riskDrawdown = get('--risk-drawdown-color', '#6b5dd3');

    return {
      ink,
      axis,
      grid,
      chartBg,
      chartText,
      chartMuted,
      patternMomentum,
      patternMeanReversion,
      patternVolatility,
      patternTrend,
      patternPattern,
      patternHighlight,
      riskMean,
      riskStress,
      riskDrawdown,
    };
  }

  private render(lines: ReturnType<MarketService['chartLines']>, mode: RenderMode): void {
    const host = this.chartContainer?.nativeElement;
    if (!host) return;

    const tokens = this.readThemeTokens();
    const riskLensEnabled = this.riskLensEnabled();

    renderMarketChart({
      host,
      lines,
      mode,
      tokens,
      compareEnabled: this.marketService.compareEnabled(),
      riskLensEnabled,
      showMeanBands: riskLensEnabled && this.showMeanBands(),
      showStressMarkers: riskLensEnabled && this.showStressMarkers(),
      showDrawdown: riskLensEnabled && this.showDrawdown(),
      patternSignals: this.isSignalLensEnabled() ? this.chartAnnotationSignals() : [],
      selectedPatternSignalId: this.selectedPatternSignalId(),
      formatPatternSignalDate: (signal) => this.formatPatternSignalDate(signal),
      onHoverChange: (info) => this.hoverInfo.set(info),
    });
  }

  private sortPatternSignals(signals: PatternSignal[], mode: PatternSortMode): PatternSignal[] {
    if (mode === 'strength') {
      return [...signals].sort(
        (a, b) =>
          b.strength - a.strength ||
          this.signalTimestamp(b) - this.signalTimestamp(a)
      );
    }

    return [...signals].sort(
      (a, b) =>
        this.signalTimestamp(b) - this.signalTimestamp(a) ||
        b.strength - a.strength
    );
  }

  private signalTimestamp(signal: PatternSignal): number {
    return (signal.endDate ?? signal.date).getTime();
  }
}
