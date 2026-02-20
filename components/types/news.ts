/**
 * News Agent Data Structures
 * Based on the NewsReportV2 schema from news_agent.py
 */

export interface NewsReliability {
    rating: "High" | "Medium" | "Low";
    reason: string;
}

export interface NewsSource {
    title: string;
    url: string;
    type: "Official" | "Major Media" | "Analytics" | "Unknown";
    category?: string;
    confirmations?: number;
    published_at?: string;
    source_name?: string;
    reliability?: "High" | "Medium" | "Low";
}

export interface PrimaryNewsSource {
    title: string;
    url: string;
    type: "Official" | "Major Media" | "Unknown";
    category?: string;
    confirmations?: number;
    published_at?: string;
    source_name?: string;
}

export interface KeyQuote {
    quote: string;
    context: string;
}

export interface WatchItem {
    signal: string;
    why: string;
}

export interface NewsData {
    asset: "BTC" | "ETH";
    catalyst_summary: string;
    what_happened: string;
    why_it_matters: string;
    causality_note: string;
    reliability: NewsReliability;
    sources: {
        primary: PrimaryNewsSource;
        supporting: NewsSource[];
    };
    key_quote: KeyQuote;
    what_to_watch: WatchItem[];
}
