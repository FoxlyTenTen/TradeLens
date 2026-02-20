/**
 * Market Analysis Data Structures
 * Based on the TechnicalReportV2 schema from market_analysis_agent.py
 */

export interface RSIIndicator {
    value: number;
    signal: "Overbought" | "Oversold" | "Neutral";
    explain?: string;
}

export interface MACDIndicator {
    histogram: number;
    signal: "Bullish Cross" | "Bearish Cross" | "None";
    explain?: string;
}

export interface BollingerBandsIndicator {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
    percent_b: number;
    message: "Riding Upper Band" | "Below Lower Band" | "Inside";
    explain?: string;
}

export interface ATRIndicator {
    value: number;
    explain?: string;
}

export interface TechnicalIndicators {
    RSI: RSIIndicator;
    MACD: MACDIndicator;
    BollingerBands: BollingerBandsIndicator;
    ATR: ATRIndicator;
}

export interface ReasonStackItem {
    title: string;
    observed: string;
    meaning: string;
    so_what: string;
}

export interface InvalidationItem {
    condition: string;
    why_it_matters: string;
}

export interface MarketBias {
    trend: "Bullish" | "Bearish" | "Neutral";
    confidence: "Low" | "Medium" | "High";
    alignment_score: number;
}

export interface MarketVolatility {
    state: "Squeeze" | "Expansion" | "Stable";
    evidence: string[];
}

export interface KeyLevels {
    support: number;
    resistance: number;
    notes?: string;
}

export interface MarketData {
    symbol: string;
    timeframe: string;
    price: number;
    change_percent: number;
    bias: MarketBias;
    volatility: MarketVolatility;
    indicators: TechnicalIndicators;
    key_levels: KeyLevels;
    reason_stack: ReasonStackItem[];
    invalidation: InvalidationItem[];
    summary_message: string;
    next_update_hint: string;
}
