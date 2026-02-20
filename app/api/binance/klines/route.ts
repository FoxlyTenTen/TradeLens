import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const symbol = searchParams.get("symbol") || "BTCUSDT";
    const interval = searchParams.get("interval") || "1m";
    const limit = searchParams.get("limit") || "400";

    const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(
        symbol
    )}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`;

    console.log(`[Binance Proxy] Fetching: ${url}`);

    try {
        const r = await fetch(url, {
            // Server-side fetch, no CORS problem
            cache: "no-store",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", // Full realistic UA
                "Accept": "application/json",
            },
        });

        if (!r.ok) {
            console.error(`[Binance Proxy] Error ${r.status}: ${r.statusText}`);
            const errorText = await r.text();
            console.error(`[Binance Proxy] Error Body: ${errorText}`);
            return NextResponse.json({ error: `Binance API error: ${r.statusText}`, details: errorText }, { status: r.status });
        }

        const data = await r.json();
        return NextResponse.json(data, {
            status: 200
        });
    } catch (error) {
        console.error(`[Binance Proxy] Exception:`, error);
        return NextResponse.json({ error: "Failed to fetch from Binance", details: String(error) }, { status: 500 });
    }
}
