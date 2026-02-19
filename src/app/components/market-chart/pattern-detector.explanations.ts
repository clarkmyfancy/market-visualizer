export type PatternNarrativeKey =
  | 'movingAverageCrossover'
  | 'rsiExtremes'
  | 'bollingerRegime'
  | 'rangeBreakout'
  | 'volatilitySpike';

type PatternNarrative = {
  explanations: string[];
  interpretation: string[];
};

const PATTERN_NARRATIVES: Record<PatternNarrativeKey, PatternNarrative> = {
  movingAverageCrossover: {
    explanations: [
      'Systematic strategies and trend-followers use moving averages, causing clustered buying/selling when a crossover happens.',
      'Moving averages summarize recent consensus; crossing often reflects a real regime shift in momentum.',
      'Risk managers and allocators adjust exposure when longer-term trends change, reinforcing the move.',
    ],
    interpretation: [
      'This signal is often associated with trend transitions rather than immediate reversals.',
      'Historically it tends to coincide with persistent momentum when the spread keeps widening after the cross.',
    ],
  },
  rsiExtremes: {
    explanations: [
      'Sharp moves exhaust marginal buyers/sellers; mean reversion can occur as participants take profits or cover.',
      'Behavioral overreaction and recency bias can push price too far relative to recent pace.',
      'Short-term liquidity imbalances (panic selling or forced selling) can drive RSI extremes.',
    ],
    interpretation: [
      'This is often associated with stretched conditions, not a guaranteed reversal.',
      'Historically it tends to coincide with elevated two-way volatility around the extreme zone.',
    ],
  },
  bollingerRegime: {
    explanations: [
      'Markets alternate between consolidation (low volatility) and repricing (breakouts) as information arrives and positions reset.',
      'Low volatility often reflects temporary agreement or lack of catalysts; once triggered, stops and breakout orders can create expansion.',
      'Option hedging and volatility targeting can amplify transitions from calm to volatile conditions.',
    ],
    interpretation: [
      'Squeezes are often associated with compressed risk that can resolve with larger directional moves.',
      'Expansions tend to coincide with repricing phases, but direction still depends on broader context.',
    ],
  },
  rangeBreakout: {
    explanations: [
      'Support/resistance zones form because traders anchor to prior highs/lows and place orders there.',
      'Breakouts trigger stop orders and momentum entries, creating one-directional flows.',
      'A break often signals new information or a shift in supply/demand balance.',
    ],
    interpretation: [
      'Range breaks are often associated with regime transitions, especially after prolonged consolidation.',
      'Historically this can coincide with follow-through when price remains outside the prior range.',
    ],
  },
  volatilitySpike: {
    explanations: [
      'Deleveraging and risk-limit breaches can force selling, increasing realized volatility.',
      'Uncertainty shocks widen spreads and reduce liquidity, magnifying moves.',
      'Volatility-targeting funds adjust exposure mechanically, which can reinforce spikes.',
    ],
    interpretation: [
      'Volatility spikes often coincide with unstable liquidity and larger intraperiod swings.',
      'Historically these regimes can persist briefly before normalizing, so position sizing matters more than direction calls.',
    ],
  },
};

export function getPatternNarrative(key: PatternNarrativeKey): PatternNarrative {
  return PATTERN_NARRATIVES[key];
}
