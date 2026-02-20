"""
Market Analysis Agent (A2A Protocol) - Deterministic JSON + AI Explanation Only
Adds: speedometer (gauge spec) + icon identifiers for UI rendering
"""
import uvicorn
import os
import json
import statistics
import httpx
from dotenv import load_dotenv
from typing import List, Any, Dict

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.utils import new_agent_text_message

from google.genai import types
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.artifacts import InMemoryArtifactService
from google.adk.agents.llm_agent import LlmAgent

load_dotenv()

# =========================
# Prompt: explanation ONLY
# =========================
EXPLANATION_PROMPT = """
You are a trading mentor for a beginner.

You will be given deterministic market scoring output (numbers + labels).
Write ONE short explanation (1–2 sentences) explaining WHY the score/signal happened.

Rules:
- Use ONLY the provided fields. Do NOT invent news, whales, events, or extra metrics.
- Be cautious: use "suggests", "may", "often". No promises.
- If signal is BUY but liquidity score is negative (low volume), warn about bull trap / fakeout risk.
- Output plain text ONLY. No JSON. No markdown.
"""

# =========================
# UI mapping helpers (icons)
# =========================

# Use these as identifiers. Your frontend can map to lucide-react icons:
#   lucide-react: TrendingUp, TrendingDown, Activity, Droplets, Zap, Gauge, CircleDashed, ShieldAlert, TriangleAlert, CircleCheck
SIGNAL_ICON = {
    "HARD BUY": "TrendingUp",
    "SOFT BUY": "TrendingUp",
    "HOLD": "CircleDashed",
    "SOFT SELL": "TrendingDown",
    "HARD SELL": "TrendingDown",
    "API ERROR": "TriangleAlert",
}

DRIVER_ICON = {
    "Liquidity": "Droplets",
    "Trend": "Activity",
    "Momentum": "Zap",
    "Volatility": "Gauge",
    "Connectivity": "TriangleAlert",
}

def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))

def score_to_gauge_value(score: int) -> int:
    """
    Map score -100..+100 to gauge 0..100.
    """
    return int(round((score + 100) / 2))

def build_speedometer(score: int, signal: str, color: str) -> Dict[str, Any]:
    """
    Return a gauge spec. UI renders it.
    Zones are in gauge space (0..100).
    """
    gv = score_to_gauge_value(score)
    return {
        "type": "speedometer",
        "min": 0,
        "max": 100,
        "value": clamp(gv, 0, 100),
        "label": signal,
        "label_color": color,
        "needle_color": "#ffffff",
        "zones": [
            {"from": 0,  "to": 10,  "label": "HARD SELL", "color": "#ef4444"},
            {"from": 11, "to": 25,  "label": "SOFT SELL", "color": "#fca5a5"},
            {"from": 26, "to": 74,  "label": "HOLD",      "color": "#fbbf24"},
            {"from": 75, "to": 89,  "label": "SOFT BUY",  "color": "#86efac"},
            {"from": 90, "to": 100, "label": "HARD BUY",  "color": "#22c55e"},
        ],
        # Optional UI helpers:
        "icon": SIGNAL_ICON.get(signal, "CircleDashed"),
        "scale_note": "Gauge 0-100 is derived from score -100..+100 (linear map).",
    }

# =========================
# Binance fetch
# =========================

async def fetch_binance_klines(symbol: str, interval: str = "1h", limit: int = 200) -> List[List[Any]]:
    sym_map = {"BTC-USD": "BTCUSDT", "ETH-USD": "ETHUSDT", "BTC": "BTCUSDT", "ETH": "ETHUSDT"}
    s = symbol.upper().strip()
    binance_symbol = sym_map.get(s, s.replace("-", "").replace("/", ""))

    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": binance_symbol, "interval": interval, "limit": limit}

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        return r.json()

def calculate_ema(values: List[float], period: int) -> List[float]:
    if len(values) < period:
        return []
    k = 2 / (period + 1)
    ema = [sum(values[:period]) / period]  # SMA seed
    for i in range(period, len(values)):
        ema.append(values[i] * k + ema[-1] * (1 - k))
    return ema

def calculate_rsi(closes: List[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0

    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def compute_decision(closes: List[float], volumes: List[float]) -> dict:
    if len(closes) < 55:
        return {"error": "Not enough data"}

    current_price = closes[-1]
    current_vol = volumes[-1]

    # 1) Liquidity 40%
    vol_20 = volumes[-20:]
    avg_vol = (sum(vol_20) / 20) if len(vol_20) == 20 else (sum(vol_20) / max(1, len(vol_20)))

    if current_vol > 1.2 * avg_vol:
        liq_score, liq_label = 100, "High Vol (Fuel)"
    elif current_vol < 0.8 * avg_vol:
        liq_score, liq_label = -50, "Low Vol (Fakeout Risk)"
    else:
        liq_score, liq_label = 0, "Average Vol"

    # 2) Trend 30% (EMA50)
    emas = calculate_ema(closes, 50)
    ema50 = emas[-1] if emas else current_price

    if current_price > ema50:
        trend_score, trend_label = 100, "Uptrend (>EMA50)"
    else:
        trend_score, trend_label = -100, "Downtrend (<EMA50)"

    # 3) Momentum 20% (RSI14)
    rsi_val = calculate_rsi(closes, 14)

    if rsi_val < 30:
        mom_score, mom_label = 100, "Oversold (Buy Dip)"
    elif rsi_val > 70:
        mom_score, mom_label = -100, "Overbought (Pullback Risk)"
    elif 30 <= rsi_val <= 40:
        mom_score, mom_label = 50, "Recovering"
    elif 60 <= rsi_val <= 70:
        mom_score, mom_label = -50, "Heating Up"
    else:
        mom_score, mom_label = 0, "Neutral"

    # 4) Volatility 10% (BB Bandwidth)
    def bw(window: List[float]) -> float:
        sma = sum(window) / len(window)
        sd = statistics.stdev(window) if len(window) > 1 else 0.0
        upper = sma + 2 * sd
        lower = sma - 2 * sd
        return (upper - lower) / sma if sma else 0.0

    bws = []
    for i in range(30):
        end = len(closes) - i
        start = end - 20
        if start < 0:
            break
        bws.append(bw(closes[start:end]))

    current_bw = bws[0] if bws else 0.0
    avg_bw = (sum(bws) / len(bws)) if bws else current_bw

    if current_bw < avg_bw:
        vol_score, vol_label = -50, "Squeeze (Risky)"
    else:
        vol_score, vol_label = 50, "Normal (Tradeable)"

    final_score = round(0.4 * liq_score + 0.3 * trend_score + 0.2 * mom_score + 0.1 * vol_score)

    if final_score >= 80:
        signal, color = "HARD BUY", "#22c55e"
    elif 50 <= final_score <= 79:
        signal, color = "SOFT BUY", "#86efac"
    elif -49 <= final_score <= 49:
        signal, color = "HOLD", "#fbbf24"
    elif -79 <= final_score <= -50:
        signal, color = "SOFT SELL", "#fca5a5"
    else:
        signal, color = "HARD SELL", "#ef4444"

    contribs = {
        "Liquidity": abs(0.4 * liq_score),
        "Trend": abs(0.3 * trend_score),
        "Momentum": abs(0.2 * mom_score),
        "Volatility": abs(0.1 * vol_score),
    }
    primary_driver = max(contribs, key=contribs.get)

    return {
        "final_score": final_score,
        "signal": signal,
        "color": color,
        "primary_driver": primary_driver,
        "components": {
            "liquidity": {"value": round(current_vol / avg_vol, 2) if avg_vol else 0.0, "score": liq_score, "label": liq_label},
            "trend": {"value": f"Price {current_price:.2f} vs EMA50 {ema50:.2f}", "score": trend_score, "label": trend_label},
            "momentum": {"value": round(rsi_val, 1), "score": mom_score, "label": mom_label},
            "volatility": {"value": f"BW {current_bw:.4f} vs Avg {avg_bw:.4f}", "score": vol_score, "label": vol_label},
        },
    }

async def get_real_market_data(symbol: str) -> dict:
    try:
        if not symbol or "BTC" in symbol.upper():
            clean_sym = "BTC-USD"
        elif "ETH" in symbol.upper():
            clean_sym = "ETH-USD"
        else:
            clean_sym = "BTC-USD"

        klines = await fetch_binance_klines(clean_sym, interval="1h", limit=200)
        if not klines:
            return {"error": "No data returned from Binance"}

        closes = [float(k[4]) for k in klines]
        volumes = [float(k[5]) for k in klines]
        curr = closes[-1]

        # 24h change using 1h candles (24 hours ago = -25 index)
        if len(closes) >= 25 and closes[-25] != 0:
            prev_24h = closes[-25]
            chg_24h = ((curr - prev_24h) / prev_24h) * 100
        else:
            prev_24h = closes[-2] if len(closes) >= 2 else curr
            chg_24h = ((curr - prev_24h) / prev_24h) * 100 if prev_24h else 0.0

        result = compute_decision(closes, volumes)
        if "error" in result:
            return result

        # Add speedometer spec here so UI always has it
        speedometer = build_speedometer(result["final_score"], result["signal"], result["color"])

        return {
            "symbol": clean_sym,
            "price": round(curr, 2),
            "change_24h": round(chg_24h, 2),
            "score": result["final_score"],
            "signal": result["signal"],
            "rank_and_color": result["color"],
            "signal_icon": SIGNAL_ICON.get(result["signal"], "CircleDashed"),
            "primary_driver": result["primary_driver"],
            "primary_driver_icon": DRIVER_ICON.get(result["primary_driver"], "Activity"),
            "speedometer": speedometer,
            "components": result["components"],
        }
    except Exception as e:
        return {"error": str(e)}

# =========================
# LLM (explanation only)
# =========================

class ExplanationOnlyLLM:
    def __init__(self):
        self._agent = LlmAgent(
            name="market_explainer",
            model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
            instruction=EXPLANATION_PROMPT,
            tools=[],  # no tools
            output_key="explanation",
            generate_content_config=types.GenerateContentConfig(temperature=0.0),
        )
        self._runner = Runner(
            app_name=self._agent.name,
            agent=self._agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )

    async def explain(self, tool_payload: dict, session_id: str) -> str:
        # Give the model the deterministic snapshot ONLY
        user_text = "Deterministic market snapshot:\n" + json.dumps(tool_payload, ensure_ascii=False)
        content = types.Content(role="user", parts=[types.Part.from_text(text=user_text)])

        session = await self._runner.session_service.get_session(
            app_name=self._agent.name, user_id="remote_agent", session_id=session_id
        )
        if not session:
            session = await self._runner.session_service.create_session(
                app_name=self._agent.name, user_id="remote_agent", state={}, session_id=session_id
            )

        out = ""
        async for event in self._runner.run_async(user_id="remote_agent", session_id=session.id, new_message=content):
            if event.is_final_response() and event.content:
                out = getattr(event.content.parts[0], "text", "").strip()
                break

        out = " ".join(out.split())
        return out[:260]

# =========================
# A2A Executor (deterministic JSON)
# =========================

class MarketAnalysisExecutor(AgentExecutor):
    def __init__(self):
        self.llm = ExplanationOnlyLLM()

    async def execute(self, ctx: RequestContext, q: EventQueue) -> None:
        user_query = ctx.get_user_input() or ""
        symbol = "BTC-USD"
        if "ETH" in user_query.upper():
            symbol = "ETH-USD"

        tool_payload = await get_real_market_data(symbol)

        if tool_payload.get("error"):
            out = {
                "symbol": symbol,
                "price": 0.0,
                "change_24h": 0.0,
                "score": 0,
                "signal": "API ERROR",
                "rank_and_color": "#ef4444",
                "signal_icon": SIGNAL_ICON["API ERROR"],
                "primary_driver": "Connectivity",
                "primary_driver_icon": DRIVER_ICON["Connectivity"],
                "speedometer": build_speedometer(0, "API ERROR", "#ef4444"),
                "explanation": f"Unable to fetch market data: {tool_payload['error']}.",
                "components": {
                    "liquidity": {"value": 0, "score": 0, "label": "N/A"},
                    "trend": {"value": "N/A", "score": 0, "label": "N/A"},
                    "momentum": {"value": 0, "score": 0, "label": "N/A"},
                    "volatility": {"value": "N/A", "score": 0, "label": "N/A"},
                },
            }
            await q.enqueue_event(new_agent_text_message(json.dumps(out, ensure_ascii=False)))
            return

        explanation = await self.llm.explain(tool_payload, getattr(ctx, "context_id", "default"))

        out = {
            "symbol": tool_payload["symbol"],
            "price": tool_payload["price"],
            "change_24h": tool_payload["change_24h"],
            "score": tool_payload["score"],
            "signal": tool_payload["signal"],
            "rank_and_color": tool_payload["rank_and_color"],
            "signal_icon": tool_payload["signal_icon"],
            "primary_driver": tool_payload["primary_driver"],
            "primary_driver_icon": tool_payload["primary_driver_icon"],
            "speedometer": tool_payload["speedometer"],
            "explanation": explanation,
            "components": tool_payload["components"],
        }

        await q.enqueue_event(new_agent_text_message(json.dumps(out, ensure_ascii=False)))

    async def cancel(self, c, q):
        pass

# =========================
# Server
# =========================

port = int(os.getenv("MARKET_AGENT_PORT", 9020))

skill = AgentSkill(
    id="market_analysis_agent",
    name="Market Analysis",
    description="Deterministic scoring + AI explanation + speedometer spec for UI.",
    tags=["crypto", "trading", "deterministic", "beginner", "dashboard"],
    examples=["Analyze BTC", "Analyze ETH", "BTC signal"],
)

public_agent_card = AgentCard(
    name="Market Analysis Agent",
    description="Deterministic scoring engine with safe AI explanation and UI speedometer output.",
    url=f"http://localhost:{port}/",
    version="2.2.0",
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    default_input_modes=["text"],
    default_output_modes=["text"],
)

def main():
    app = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=DefaultRequestHandler(MarketAnalysisExecutor(), InMemoryTaskStore()),
        extended_agent_card=public_agent_card,
    )
    print(f"Starting Market Analysis Agent on port {port}")
    uvicorn.run(app.build(), host="0.0.0.0", port=port)

if __name__ == "__main__":
    main()
