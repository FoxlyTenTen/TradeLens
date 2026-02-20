/**
 * Sentiment Agent Data Structures
 * Based on the SentimentReport schema from sentiment_agent.py
 */

export interface SentimentCore {
    score: number;
    label: string;
    change_24h: number;
}

export interface AnalysisCore {
    interpretation: string;
    psychology: string;
    historical_context: string;
}

export interface SentimentData {
    asset: string;
    timeframe: string;
    as_of: string;
    attribution?: string;
    image_url?: string;

    sentiment: SentimentCore;
    analysis: AnalysisCore;
    market_context: string[]; // List of general market factors

    summary_message: string;
    next_update_hint: string;
}
