"""
Sentiment Agent (A2A Protocol) - Deterministic, No Hallucinations

- Fetches REAL Fear & Greed Index from Alternative.me
- Builds STRICT JSON response in code (not by an LLM)
- Includes speedometer/gauge spec for UI rendering
- Optional "pulse" mode returns a single plain text line
"""

import os
import json
import time
from typing import Dict, Any
from datetime import datetime, timezone

import uvicorn
import httpx
from dotenv import load_dotenv

# A2A Imports
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.utils import new_agent_text_message

load_dotenv()

# =========================
# Config
# =========================

PORT = int(os.getenv("SENTIMENT_AGENT_PORT", 9022))
ALT_FNG_URL = "https://api.alternative.me/fng/"
ATTRIBUTION = "Data provided by Alternative.me"
IMAGE_URL = "https://alternative.me/crypto/fear-and-greed-index.png"

# Cache to reduce API calls
_CACHE: Dict[str, Any] = {"ts": 0.0, "data": None}
_CACHE_TTL_SECONDS = 30


# =========================
# Helpers
# =========================

def _iso_from_unix_seconds(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

def _date_from_unix_seconds(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()

def _mode_from_query(q: str) -> str:
    """
    Mode 1: pulse check = one-line output
    Mode 2: deep = strict JSON output
    """
    q = (q or "").strip().lower()
    if not q:
        return "deep"

    pulse_keywords = [
        "pulse", "quick", "now", "current", "today", "latest",
        "sentiment?", "fear greed", "fng", "index now"
    ]
    deep_keywords = ["explain", "analysis", "why", "detail", "deep", "dashboard", "json"]

    if any(k in q for k in deep_keywords):
        return "deep"
    if len(q) <= 30 or any(k in q for k in pulse_keywords):
        return "pulse"
    return "deep"

def _regime_and_bias(score: int) -> Dict[str, str]:
    """
    Deterministic interpretation. No hallucinations.
    """
    if score <= 24:
        regime = "risk_off"
        bias = "accumulate_bias"
    elif score <= 49:
        regime = "neutral"
        bias = "wait_for_confirmation"
    elif score <= 74:
        regime = "neutral"
        bias = "wait_for_confirmation"
    else:
        regime = "risk_on"
        bias = "take_profit_bias"
    return {"regime": regime, "bias": bias}

def _confidence(score: int, change_24h: int) -> str:
    """
    Deterministic confidence based on extremity + direction.
    Still no fabricated facts.
    """
    extreme = score <= 24 or score >= 75
    big_move = abs(change_24h) >= 10
    if extreme and big_move:
        return "High"
    if extreme or big_move:
        return "Medium"
    return "Low"

def _analysis_text(score: int, label: str, change_24h: int) -> Dict[str, Any]:
    """
    All text is generic psychology context, not fake news.
    Deterministic templates based on score bands.
    """
    rb = _regime_and_bias(score)
    conf = _confidence(score, change_24h)

    if score <= 24:
        interpretation = (
            f"Score {score} ({label}) signals panic-level risk aversion. "
            "This can mark capitulation zones, but reversals still need confirmation."
        )
        psychology = "Crowd mood is defensive; traders often de-risk and avoid exposure."
        historical_context = "Extreme fear often appears after sharp selloffs; it can precede rebounds, but timing is unreliable."
        context = [
            "Higher perceived risk typically reduces risk-taking and leverage.",
            "Volatility tends to rise as traders react emotionally.",
            "Markets may need stabilization (lower volatility, base-building) before a durable turn."
        ]
        invalidation = [
            {
                "condition": "If the index stays in Extreme Fear while volatility remains elevated and price keeps trending down.",
                "why_it_matters": "Fear can persist; without stabilization, catching a falling knife risk stays high."
            }
        ]
    elif score <= 49:
        interpretation = (
            f"Score {score} ({label}) suggests cautious sentiment. "
            "The market is nervous, but not in full capitulation."
        )
        psychology = "Crowd mood is hesitant; traders seek reassurance and avoid aggressive entries."
        historical_context = "Fear zones often happen during choppy downtrends or uncertain recoveries."
        context = [
            "Uncertainty usually increases selective buying and faster profit-taking.",
            "Traders often wait for clearer trend signals before committing.",
        ]
        invalidation = [
            {
                "condition": "If sentiment improves but price action fails to confirm (continued lower highs/lower lows).",
                "why_it_matters": "A sentiment bounce without price confirmation can be a dead-cat bounce."
            }
        ]
    elif score <= 74:
        interpretation = (
            f"Score {score} ({label}) indicates balanced-to-optimistic sentiment. "
            "Risk appetite exists, but it’s not euphoric."
        )
        psychology = "Crowd mood is steady; traders are willing to hold risk if trend stays supportive."
        historical_context = "Neutral-to-greed zones often align with trending markets and controlled pullbacks."
        context = [
            "Trend continuation is more likely when sentiment is supportive but not extreme.",
            "Overconfidence risk grows if sentiment keeps climbing without pauses."
        ]
        invalidation = [
            {
                "condition": "If sentiment remains high but momentum weakens and volatility expands on selloffs.",
                "why_it_matters": "That combination can signal distribution and rising downside risk."
            }
        ]
    else:
        interpretation = (
            f"Score {score} ({label}) signals overheating/euphoria risk. "
            "That can precede pullbacks, especially if momentum starts fading."
        )
        psychology = "Crowd mood is aggressive; traders chase upside and accept worse entries."
        historical_context = "Extreme greed often appears in late-stage runs; pullbacks can happen fast, but not guaranteed."
        context = [
            "FOMO typically increases late entries and leverage.",
            "Corrections often start when buyers tire and late longs get forced out."
        ]
        invalidation = [
            {
                "condition": "If the index stays elevated but price continues making higher highs with stable volatility.",
                "why_it_matters": "Greed can persist in strong trends; fading too early can be costly."
            }
        ]

    summary = f"Sentiment is {label} at {score}/100; treat it as a risk-regime signal, not a trade trigger."
    next_watch = "Watch whether sentiment cools while volatility and price action stabilize; confirmation matters more than the number."

    return {
        "interpretation": interpretation,
        "psychology": psychology,
        "historical_context": historical_context,
        "market_context": context[:3],
        "invalidation": invalidation,
        "regime": rb["regime"],
        "bias": rb["bias"],
        "confidence": conf,
        "summary_message": summary,
        "next_update_hint": next_watch
    }

def _gauge_spec(score: int) -> Dict[str, Any]:
    return {
        "type": "speedometer",
        "min": 0,
        "max": 100,
        "value": score,
        "needle_color": "white",
        "zones": [
            {"from": 0, "to": 24, "name": "Extreme Fear", "ui_color": "red"},
            {"from": 25, "to": 49, "name": "Fear", "ui_color": "orange"},
            {"from": 50, "to": 74, "name": "Neutral", "ui_color": "yellow"},
            {"from": 75, "to": 90, "name": "Greed", "ui_color": "light_green"},
            {"from": 91, "to": 100, "name": "Extreme Greed", "ui_color": "green"},
        ],
    }


# =========================
# Tool: Alternative.me API
# =========================

async def get_market_sentiment(_: str = "BTC") -> Dict[str, Any]:
    """
    Returns deterministic payload using real Alternative.me API data.
    We ignore ticker because F&G is market-wide.
    """
    now = time.time()
    if _CACHE["data"] and (now - _CACHE["ts"] < _CACHE_TTL_SECONDS):
        return _CACHE["data"]

    params = {"limit": 2, "format": "json"}  # 2 to compute delta vs previous value
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(ALT_FNG_URL, params=params)
            r.raise_for_status()
            payload = r.json()

        items = payload.get("data") or []
        if len(items) < 1:
            raise ValueError("API returned no data")

        latest = items[0]
        score = int(latest["value"])
        label = str(latest["value_classification"])
        ts = int(latest["timestamp"])

        change_24h = 0
        if len(items) >= 2:
            prev_score = int(items[1]["value"])
            change_24h = score - prev_score

        data = {
            "asset": "MARKET (BTC/Crypto)",
            "timeframe": "daily",
            "as_of": _iso_from_unix_seconds(ts),
            "sentiment_date": _date_from_unix_seconds(ts),
            "source": "Alternative.me Fear and Greed Index",
            "attribution": ATTRIBUTION,
            "image_url": IMAGE_URL,
            "sentiment_score": score,
            "sentiment_label": label,
            "sentiment_change_24h": change_24h,
            "timestamp": ts,
        }

        _CACHE["ts"] = now
        _CACHE["data"] = data
        return data

    except Exception as e:
        return {
            "error": str(e),
            "asset": "MARKET (BTC/Crypto)",
            "timeframe": "daily",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "sentiment_date": datetime.now(timezone.utc).date().isoformat(),
            "source": "Alternative.me Fear and Greed Index",
            "attribution": ATTRIBUTION,
            "image_url": IMAGE_URL,
            "sentiment_score": 0,
            "sentiment_label": "Error",
            "sentiment_change_24h": 0,
            "timestamp": 0,
        }


# =========================
# Deterministic "Agent"
# =========================

class SentimentAgentExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        user_q = context.get_user_input() or ""
        mode = _mode_from_query(user_q)

        tool = await get_market_sentiment("BTC")
        if tool.get("error"):
            # Even in error, keep output valid + attributed.
            if mode == "pulse":
                msg = f"Crypto Market Sentiment: Error (0), 24h change: 0. {ATTRIBUTION}."
                await event_queue.enqueue_event(new_agent_text_message(msg))
                return

            out = {
                "asset": "Crypto Market",
                "timeframe": "Daily",
                "as_of": tool["as_of"],
                "attribution": ATTRIBUTION,
                "image_url": tool["image_url"],
                "sentiment": {
                    "score": tool["sentiment_score"],
                    "label": tool["sentiment_label"],
                    "change_24h": tool["sentiment_change_24h"],
                },
                "gauge": _gauge_spec(tool["sentiment_score"]),
                "analysis": {
                    "interpretation": "Sentiment data fetch failed. Try again later.",
                    "psychology": "N/A",
                    "historical_context": "N/A",
                },
                "market_context": ["API/network issue."],
                "summary_message": "Sentiment unavailable due to data fetch error.",
                "next_update_hint": "Retry when network/API is available.",
            }
            await event_queue.enqueue_event(new_agent_text_message(json.dumps(out, ensure_ascii=False)))
            return

        score = int(tool["sentiment_score"])
        label = str(tool["sentiment_label"])
        change_24h = int(tool["sentiment_change_24h"])

        if mode == "pulse":
            msg = f"Crypto Market Sentiment: {label} ({score}), 24h change: {change_24h}. {ATTRIBUTION}."
            await event_queue.enqueue_event(new_agent_text_message(msg))
            return

        analysis = _analysis_text(score, label, change_24h)

        out = {
            "asset": "Crypto Market",
            "timeframe": "Daily",
            "as_of": tool["as_of"],
            "attribution": ATTRIBUTION,
            "image_url": tool["image_url"],
            "sentiment": {
                "score": score,
                "label": label,
                "change_24h": change_24h,
            },
            "gauge": _gauge_spec(score),
            "analysis": {
                "interpretation": analysis["interpretation"],
                "psychology": analysis["psychology"],
                "historical_context": analysis["historical_context"],
            },
            "market_context": analysis["market_context"],
            "summary_message": analysis["summary_message"],
            "next_update_hint": analysis["next_update_hint"],
            # Optional extra fields your UI can use (won't break JSON consumers)
            "interpretation_meta": {
                "regime": analysis["regime"],
                "bias": analysis["bias"],
                "confidence": analysis["confidence"],
            },
            "invalidation": analysis["invalidation"],
        }

        await event_queue.enqueue_event(new_agent_text_message(json.dumps(out, ensure_ascii=False)))

    async def cancel(self, context, event_queue):
        pass


# =========================
# A2A Server Setup
# =========================

skill = AgentSkill(
    id="sentiment_agent",
    name="Sentiment Analyst",
    description="Deterministic Fear & Greed sentiment (Alternative.me) with speedometer gauge JSON.",
    tags=["crypto", "sentiment", "fear_greed", "dashboard"],
    examples=["Sentiment now", "fear greed index", "Explain market sentiment"],
)

public_agent_card = AgentCard(
    name="Sentiment Agent",
    description="Specialist in Fear & Greed sentiment with strict JSON output (no hallucinations).",
    url=f"http://localhost:{PORT}/",
    version="2.0.0",
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    default_input_modes=["text"],
    default_output_modes=["text"],
)

def main():
    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=DefaultRequestHandler(SentimentAgentExecutor(), InMemoryTaskStore()),
        extended_agent_card=public_agent_card,
    )
    print(f"Starting Sentiment Agent on port {PORT}")
    uvicorn.run(server.build(), host="0.0.0.0", port=PORT)

if __name__ == "__main__":
    main()
