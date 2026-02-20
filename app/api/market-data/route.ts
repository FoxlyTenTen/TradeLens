import { NextResponse } from 'next/server';
import YF from 'yahoo-finance2';

const yahooFinance = new YF();
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const rawInterval = searchParams.get('interval') || '15m';

    if (!symbol) {
        return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    }

    // Map timeframes to supported Yahoo Finance intervals
    let interval: "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "1d" | "5d" | "1wk" | "1mo" | "3mo" = "15m";

    if (rawInterval === '1H') interval = '1h';
    else if (rawInterval === '1D') interval = '1d';
    else if (rawInterval === '4H') interval = '1h'; // Yahoo doesn't support 4h directly
    else if (['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo'].includes(rawInterval)) {
        interval = rawInterval as any;
    }

    try {
        const [chartData, quoteData] = await Promise.all([
            yahooFinance.chart(symbol, {
                period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Get 30 days of data for indicators
                interval: interval,
            }),
            yahooFinance.quote(symbol)
        ]);

        if (!chartData || !chartData.quotes || chartData.quotes.length === 0) {
            return NextResponse.json({ error: 'No data found' }, { status: 404 });
        }

        const safeQuotes = Array.isArray(chartData.quotes) ? chartData.quotes : [];

        return NextResponse.json({
            quotes: safeQuotes,
            price: quoteData.regularMarketPrice || chartData.meta.regularMarketPrice
        });

    } catch (error: any) {
        console.error("Yahoo Finance API Error:", error);
        return NextResponse.json({ error: error.message || 'Failed to fetch data' }, { status: 500 });
    }
}
