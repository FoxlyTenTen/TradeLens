from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
import pandas_ta as ta
import uvicorn
import os
import json
import logging
import asyncio

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Pandas TA Indicators Service")

# CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class IndicatorRequest(BaseModel):
    symbol: str
    interval: str = "1h"
    indicators: list[str] = []

def get_market_data(symbol: str, interval: str, indicators: list[str]):
    try:
        logger.info(f"Processing {symbol} {interval}")
        
        # Map frontend interval to yfinance interval
        # Valid yfinance intervals: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo
        yf_interval = interval
        if interval == "1H": yf_interval = "1h"
        if interval == "1D": yf_interval = "1d"
        if interval == "4H": yf_interval = "1h" # Fallback

        # Determine period based on interval to ensure enough data for indicators
        period = "1mo"
        if yf_interval in ["1m", "2m", "5m"]: period = "1d"
        elif yf_interval in ["15m", "30m", "1h"]: period = "5d"
        
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=yf_interval)
        
        if df.empty:
            return {"error": f"No data found for {symbol}"}

        # yfinance history already has numeric columns and usually no MultiIndex for single ticker
        # But let's be safe
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        # Calculate Indicators
        results = {}
        
        # Basic Price Data
        last_row = df.iloc[-1]
        prev_row = df.iloc[-2] if len(df) > 1 else last_row
        
        price = float(last_row['Close'])
        prev_close = float(prev_row['Close'])
        change = ((price - prev_close) / prev_close) * 100 if prev_close != 0 else 0.0
        
        results['price'] = price
        results['change'] = change
        
        # Pandas TA
        for ind in indicators:
            ind_name = ind.lower()
            try:
                if hasattr(df.ta, ind_name):
                    method = getattr(df.ta, ind_name)
                    res = method(append=False) 
                    
                    if res is not None:
                        if isinstance(res, pd.DataFrame):
                            last_vals = res.iloc[-1].to_dict()
                            clean_vals = {k: (float(v) if pd.notna(v) else None) for k, v in last_vals.items()}
                            results[ind_name.upper()] = clean_vals
                        elif isinstance(res, pd.Series):
                            val = res.iloc[-1]
                            results[ind_name.upper()] = float(val) if pd.notna(val) else None
            except Exception as e:
                logger.error(f"Error calculating {ind_name}: {e}")
                results[ind_name.upper()] = None

        return results
    except Exception as e:
        logger.error(f"Error in calculation: {e}")
        return {"error": str(e)}

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "pandas-ta-service"}

@app.get("/list_indicators")
def list_indicators():
    return {
        "indicators": [
            "rsi", "macd", "bbands", "atr", "sma", "ema", "wema", "roc", 
            "adx", "cci", "stoch", "obv", "willr", "mfi", "mom", "bop", 
            "apo", "aroon", "chop", "cmo", "coppock", "dpo", "kcurt", 
            "massi", "natr", "pdist", "ppo", "psar", "pvol", "qstick", 
            "stochrsi", "trix", "tsi", "ultosc", "vortex"
        ]
    }

@app.post("/calculate")
def calculate_indicators(req: IndicatorRequest):
    # Synchronous wrapper for HTTP - use 'def' to run in threadpool
    return get_market_data(req.symbol, req.interval, req.indicators)

@app.websocket("/ws/indicators")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        # Wait for initial config
        config_text = await websocket.receive_text()
        config = json.loads(config_text)
        
        symbol = config.get("symbol", "BTC-USD")
        interval = config.get("interval", "1h")
        indicators = config.get("indicators", [])

        logger.info(f"WS Connected for {symbol}")

        while True:
            # Run blocking calculation in thread pool to not block async loop
            data = await asyncio.to_thread(get_market_data, symbol, interval, indicators)
            
            await websocket.send_json(data)
            
            # Push updates every 2 seconds
            await asyncio.sleep(2)
            
    except WebSocketDisconnect:
        logger.info("WS Client disconnected")
    except Exception as e:
        logger.error(f"WS Error: {e}")
        try:
            await websocket.close()
        except:
            pass

if __name__ == "__main__":
    port = int(os.getenv("INDICATOR_PORT", 9030))
    uvicorn.run(app, host="0.0.0.0", port=port)
