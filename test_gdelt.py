
import httpx
import asyncio
import json
from datetime import datetime, timezone, timedelta

GDELT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc"

def _fmt_gdelt_dt(dt: datetime) -> str:
    return dt.strftime("%Y%m%d%H%M%S")

def _build_query(symbol: str) -> str:
    s = symbol.upper()
    if s.startswith("BTC"):
        return '(bitcoin OR btc OR "BTCUSD")'
    if s.startswith("ETH"):
        return '(ethereum OR eth OR "ETHUSD")'
    return f'("{s}")'

async def test_gdelt():
    try:
        hours_back = 24
        max_records = 80
        symbol = "BTCUSD"
        
        query = _build_query(symbol)
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(hours=hours_back)

        params = {
            "query": query,
            "mode": "ArtList",
            "format": "json",
            "sort": "Date",  # TESTING THIS
            "maxrecords": str(max_records),
            "startdatetime": _fmt_gdelt_dt(start_dt),
            "enddatetime": _fmt_gdelt_dt(end_dt),
            
        }

        print(f"Requesting GDELT with params: {params}")

        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(GDELT_DOC, params=params)
            print(f"Status Code: {r.status_code}")
            
            if "Please limit requests to one every 5 seconds" in r.text:
                print("Rate limited.")
                return

            r.raise_for_status()
            data = r.json()
            print("GDELT Response Keys:", data.keys())
            articles = data.get("articles")
            if articles:
                print(f"Found {len(articles)} articles.")
                print("First article:", articles[0])
            else:
                print("No articles found (but request succeeded).")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_gdelt())
