"""
Behavior Agent (ADK + A2A Protocol)
Analyzes trader psychology and history to detect 'Tilt', revenge trading, and toxic asset patterns.
Uses DETERMINISTIC scoring (like Market Analysis Agent) + LLM explanation only.
"""
import uvicorn
import os
import json
import time
import re
from dotenv import load_dotenv

# A2A Imports
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.utils import new_agent_text_message

# ADK Imports
from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.artifacts import InMemoryArtifactService
from google.genai import types as genai_types

# Supabase
from supabase import create_client, Client

load_dotenv()

# Hardcoded credentials
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")


def get_supabase() -> Client:
    try:
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"[BEHAVIOR] Supabase init error: {e}")
        raise


# ============================
# Helpers
# ============================

def _safe_float(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return default


def _safe_int(v, default=0):
    try:
        return int(v)
    except Exception:
        return default


def normalize_symbol(s: str) -> str:
    """Normalizes a trading symbol for comparison (e.g. 'BTC/USD' -> 'BTCUSD')."""
    if not s:
        return "UNKNOWN"
    return s.upper().strip().replace("/", "").replace("-", "").replace(" ", "")


def _ts_from_bigint(v):
    """Convert bigint timestamp (ms or sec) to seconds float."""
    if v is None:
        return None
    try:
        n = int(v)
        if n > 10_000_000_000:  # ms epoch
            return n / 1000.0
        return float(n)
    except Exception:
        return None


def _fetch_trades(supabase: Client, user_id: str, limit: int = 60) -> list:
    """Fetch trade history from public.trade_history for a given user_id."""
    try:
        print(f"[BEHAVIOR] Fetching trades for user_id='{user_id}', limit={limit}")
        resp = supabase.table("trade_history").select(
            "transaction_id,user_id,symbol,buy_time,sell_time,buy_price,sell_price,profit,status"
        ).eq("user_id", user_id).order("buy_time", desc=True).limit(limit).execute()
    except Exception as e:
        print(f"[BEHAVIOR] Error fetching trades: {e}")
        return []

    raw = resp.data or []
    print(f"[BEHAVIOR] Fetched {len(raw)} raw trades from DB")

    trades = []
    for t in raw:
        buy_ts = _ts_from_bigint(t.get("buy_time"))
        sell_ts = _ts_from_bigint(t.get("sell_time"))
        ts = sell_ts if sell_ts is not None else buy_ts
        if ts is None:
            continue

        trades.append({
            "transaction_id": t.get("transaction_id"),
            "user_id": t.get("user_id"),
            "symbol": t.get("symbol"),
            "buy_time": buy_ts,
            "sell_time": sell_ts,
            "buy_price": _safe_float(t.get("buy_price"), 0.0),
            "sell_price": _safe_float(t.get("sell_price"), 0.0),
            "profit": _safe_float(t.get("profit"), 0.0),
            "status": t.get("status"),
            "_ts": ts,
        })
    trades.sort(key=lambda x: x["_ts"], reverse=True)
    print(f"[BEHAVIOR] Processed {len(trades)} valid trades")
    return trades


def _fetch_user_constraints(supabase: Client, user_id: str) -> dict:
    """Fetch user constraints from public.user_constraints."""
    try:
        resp = supabase.table("user_constraints").select("*").eq("user_id", user_id).limit(1).execute()
        rows = resp.data or []
        if rows:
            c = rows[0]
            return {
                "max_daily_loss": _safe_float(c.get("max_daily_loss"), 50.0),
                "max_daily_trades": _safe_int(c.get("max_daily_trades"), 10),
                "risk_per_trade_pct": _safe_float(c.get("risk_per_trade_pct"), 2.0),
                "max_consecutive_losses": _safe_int(c.get("max_consecutive_losses"), 3),
            }
    except Exception as e:
        print(f"[BEHAVIOR] Error fetching user_constraints: {e}")

    # Return defaults if not found
    return {
        "max_daily_loss": 50.0,
        "max_daily_trades": 10,
        "risk_per_trade_pct": 2.0,
        "max_consecutive_losses": 3,
    }


def _extract_user_id(query: str, default=None) -> str:
    """Extract user_id from query text."""
    if not query:
        return default or "Good_Trader"

    # Try explicit user_id=XYZ
    m = re.search(r"user_id\s*=\s*['\"]?([^'\"\s,]+)['\"]?", query, flags=re.IGNORECASE)
    if m:
        return m.group(1)

    # Try natural language
    q = query.lower()
    if "bad trader" in q or "bad_trader" in q:
        return "Bad_Trader"
    if "good trader" in q or "good_trader" in q:
        return "Good_Trader"

    return default or "Good_Trader"


# ============================
# DETERMINISTIC BEHAVIOR ANALYSIS
# ============================

def compute_behavior_metrics(user_id: str, current_asset: str = "BTCUSD") -> dict:
    """
    Deterministic behavior analysis engine.
    Fetches REAL data from Supabase and computes all metrics in Python.
    NO LLM involved in data calculation.
    """
    current_asset_clean = normalize_symbol(current_asset)

    try:
        supabase = get_supabase()
        trades = _fetch_trades(supabase, user_id, limit=60)
        constraints = _fetch_user_constraints(supabase, user_id)
    except Exception as e:
        return {
            "error": f"DB Error: {str(e)}",
            "user_id": user_id,
            "current_asset_context": current_asset_clean,
        }

    # ------- NO TRADES CASE -------
    if not trades:
        return {
            "user_id": user_id,
            "current_asset_context": current_asset_clean,
            "tilt_score": 0,
            "status": "NORMAL",
            "block_trade": False,
            "coach_message": f"No trading history found for {user_id}. Start trading and I'll track your behavior.",
            "current_state": {
                "seconds_since_last_trade": 0,
                "last_result": "N/A",
                "current_loss_streak": 0,
                "is_revenge_trading_risk": False,
            },
            "patterns": {
                "toxic_asset": None,
                "toxic_asset_win_rate": "N/A",
                "is_viewing_toxic_asset": False,
            },
            "daily_metrics": {
                "daily_trade_count": 0,
                "daily_pnl": 0.0,
                "max_daily_trades": constraints["max_daily_trades"],
                "max_daily_loss": constraints["max_daily_loss"],
            },
            "violations": [],
            "constraints": constraints,
            "trade_count": 0,
            "note": f"No history for {user_id}",
        }

    # ------- COMPUTE METRICS -------
    now = time.time()
    last_trade = trades[0]
    last_profit = last_trade["profit"]
    last_result = "WIN" if last_profit > 0 else ("LOSS" if last_profit < 0 else "BREAKEVEN")

    last_ts = last_trade.get("sell_time") or last_trade.get("buy_time") or last_trade["_ts"]
    seconds_since_last_trade = max(0, int(now - last_ts))

    # Revenge risk: Loss < 5 mins ago
    is_revenge_risk = (last_profit < 0) and (seconds_since_last_trade < 300)

    # Loss streak (consecutive losses from most recent)
    loss_streak = 0
    for t in trades:
        if t["profit"] < 0:
            loss_streak += 1
        else:
            break

    # --- Daily metrics (last 24 hours) ---
    cutoff_24h = now - 86400
    daily_trades = [t for t in trades if t["_ts"] >= cutoff_24h]
    daily_trade_count = len(daily_trades)
    daily_pnl = sum(t["profit"] for t in daily_trades)

    # --- Win/Loss statistics ---
    total_trades = len(trades)
    wins = sum(1 for t in trades if t["profit"] > 0)
    losses = sum(1 for t in trades if t["profit"] < 0)
    total_pnl = sum(t["profit"] for t in trades)
    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0.0

    # --- Toxic Asset Detection ---
    asset_stats = {}
    for t in trades:
        a = normalize_symbol(t["symbol"])
        s = asset_stats.setdefault(a, {"wins": 0, "total": 0, "pnl": 0.0})
        s["total"] += 1
        s["pnl"] += t["profit"]
        if t["profit"] > 0:
            s["wins"] += 1

    toxic_asset = None
    worst_win_rate = 1.0
    for asset, stats in asset_stats.items():
        if stats["total"] >= 3:
            wr = stats["wins"] / stats["total"]
            if wr < 0.4 and wr <= worst_win_rate:
                worst_win_rate = wr
                toxic_asset = asset

    is_viewing_toxic_asset = (toxic_asset is not None) and (current_asset_clean == toxic_asset)

    # --- Violations ---
    violations = []
    if daily_trade_count > constraints["max_daily_trades"]:
        violations.append(f"Exceeded max daily trades ({daily_trade_count}/{constraints['max_daily_trades']})")

    if daily_pnl < 0 and abs(daily_pnl) > constraints["max_daily_loss"]:
        violations.append(f"Exceeded max daily loss (${abs(daily_pnl):.2f}/${constraints['max_daily_loss']:.2f})")

    if loss_streak > constraints["max_consecutive_losses"]:
        violations.append(f"Exceeded max consecutive losses ({loss_streak}/{constraints['max_consecutive_losses']})")

    # ============================
    # DETERMINISTIC TILT SCORE
    # ============================
    tilt_score = 0

    # Factor 1: Revenge trading risk (+30)
    if is_revenge_risk:
        tilt_score += 30

    # Factor 2: Loss streak (+5 per loss, max +25)
    tilt_score += min(loss_streak * 5, 25)

    # Factor 3: Viewing toxic asset (+20)
    if is_viewing_toxic_asset:
        tilt_score += 20

    # Factor 4: Constraint violations (+10 each, max +20)
    tilt_score += min(len(violations) * 10, 20)

    # Factor 5: Daily loss severity (+5 if daily_pnl < -max_daily_loss/2)
    if daily_pnl < 0 and abs(daily_pnl) > constraints["max_daily_loss"] / 2:
        tilt_score += 5

    # Clamp to 0-100
    tilt_score = min(max(tilt_score, 0), 100)

    # --- Status ---
    if tilt_score >= 70:
        status = "CRITICAL"
    elif tilt_score >= 40:
        status = "WARNING"
    else:
        status = "NORMAL"

    # --- Block trade decision ---
    block_trade = tilt_score >= 70 or len(violations) >= 2

    # --- Coach message (deterministic) ---
    parts = []
    if is_revenge_risk:
        parts.append(f"Your last trade was a LOSS just {seconds_since_last_trade}s ago. High revenge trading risk.")
    if loss_streak >= 2:
        parts.append(f"You are on a {loss_streak}-trade losing streak.")
    if is_viewing_toxic_asset:
        parts.append(f"WARNING: You are viewing {current_asset_clean}, where your win rate is only {worst_win_rate * 100:.0f}%.")
    if violations:
        parts.append(f"You have {len(violations)} constraint violation(s): {'; '.join(violations)}.")
    if daily_pnl < 0:
        parts.append(f"Your daily P&L is ${daily_pnl:.2f}.")

    if not parts:
        if status == "NORMAL":
            parts.append(f"You're in good shape. Win rate: {win_rate:.0f}% over {total_trades} trades. Keep it up!")
        else:
            parts.append("Minor concerns detected. Stay disciplined.")

    if block_trade:
        parts.append("Trading is BLOCKED. Take a 5-minute break to cool down.")

    coach_message = " ".join(parts)

    return {
        "user_id": user_id,
        "current_asset_context": current_asset_clean,
        "tilt_score": tilt_score,
        "status": status,
        "block_trade": block_trade,
        "coach_message": coach_message,
        "current_state": {
            "seconds_since_last_trade": seconds_since_last_trade,
            "last_result": last_result,
            "current_loss_streak": loss_streak,
            "is_revenge_trading_risk": is_revenge_risk,
        },
        "patterns": {
            "toxic_asset": toxic_asset,
            "toxic_asset_win_rate": f"{worst_win_rate * 100:.1f}%" if toxic_asset else "N/A",
            "is_viewing_toxic_asset": is_viewing_toxic_asset,
        },
        "daily_metrics": {
            "daily_trade_count": daily_trade_count,
            "daily_pnl": round(daily_pnl, 2),
            "max_daily_trades": constraints["max_daily_trades"],
            "max_daily_loss": constraints["max_daily_loss"],
        },
        "violations": violations,
        "constraints": constraints,
        "trade_count": total_trades,
        "overall_stats": {
            "total_trades": total_trades,
            "wins": wins,
            "losses": losses,
            "win_rate": round(win_rate, 1),
            "total_pnl": round(total_pnl, 2),
        },
    }


# ============================
# LLM Explainer (explanation only, like Market Agent)
# ============================

EXPLANATION_PROMPT = """You are a trading psychologist reviewing a trader's behavioral data.

You will receive DETERMINISTIC behavioral metrics computed from real trade history.
Write ONE short, personalized coach message (2-3 sentences max) based on the data.

Rules:
- Reference SPECIFIC numbers from the data (loss streak count, tilt score, win rate, daily P&L).
- Be empathetic but firm. You are their accountability partner.
- If tilt_score is HIGH (>= 70): Be urgent and direct. Tell them to STOP trading now.
- If tilt_score is MODERATE (40-69): Warn them and suggest caution.
- If tilt_score is LOW (< 40): Encourage them but remind them to stay disciplined.
- If they have violations, mention the specific ones.
- Output plain text ONLY. No JSON. No markdown.
"""


class BehaviorExplainerLLM:
    """LLM used ONLY for generating the coach_message explanation."""

    def __init__(self):
        self._agent = LlmAgent(
            name="behavior_explainer",
            model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
            instruction=EXPLANATION_PROMPT,
            tools=[],
            output_key="explanation",
            generate_content_config=genai_types.GenerateContentConfig(temperature=0.3),
        )
        self._runner = Runner(
            app_name=self._agent.name,
            agent=self._agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )

    async def explain(self, metrics: dict, session_id: str) -> str:
        """Generate a human-friendly coach message from metrics."""
        user_text = "Behavioral analysis data:\n" + json.dumps(metrics, ensure_ascii=False, default=str)
        content = genai_types.Content(role="user", parts=[genai_types.Part.from_text(text=user_text)])

        session = await self._runner.session_service.get_session(
            app_name=self._agent.name, user_id="remote_agent", session_id=session_id
        )
        if not session:
            session = await self._runner.session_service.create_session(
                app_name=self._agent.name, user_id="remote_agent", state={}, session_id=session_id
            )

        out = ""
        async for event in self._runner.run_async(
            user_id="remote_agent", session_id=session.id, new_message=content
        ):
            if event.is_final_response() and event.content:
                out = getattr(event.content.parts[0], "text", "").strip()
                break

        # Clean and truncate
        out = " ".join(out.split())
        return out[:400] if out else ""


# ============================
# A2A Executor (Deterministic JSON output)
# ============================

class BehaviorAgentExecutor(AgentExecutor):
    """
    Deterministic executor like MarketAnalysisExecutor.
    Computes all metrics in Python, uses LLM only for coach message.
    """

    def __init__(self):
        self.llm = BehaviorExplainerLLM()

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        user_query = context.get_user_input() or ""
        session_id = getattr(context, "context_id", "default")

        print(f"[BEHAVIOR] Received query: {user_query[:100]}")

        # 1. Extract user_id from query
        user_id = _extract_user_id(user_query)
        print(f"[BEHAVIOR] Resolved user_id: {user_id}")

        # 2. Compute deterministic metrics
        metrics = compute_behavior_metrics(user_id=user_id)

        if metrics.get("error"):
            # Return error payload
            error_out = {
                "tilt_score": 0,
                "status": "NORMAL",
                "block_trade": False,
                "coach_message": f"Unable to analyze behavior: {metrics['error']}",
                "user_id": user_id,
                "current_asset_context": metrics.get("current_asset_context", "UNKNOWN"),
                "current_state": {
                    "seconds_since_last_trade": 0,
                    "last_result": "N/A",
                    "current_loss_streak": 0,
                    "is_revenge_trading_risk": False,
                },
                "patterns": {
                    "toxic_asset": None,
                    "toxic_asset_win_rate": "N/A",
                    "is_viewing_toxic_asset": False,
                },
            }
            await event_queue.enqueue_event(new_agent_text_message(json.dumps(error_out, ensure_ascii=False)))
            return

        # 3. Generate LLM-powered coach message (enhance the deterministic one)
        try:
            llm_message = await self.llm.explain(metrics, session_id)
            if llm_message:
                metrics["coach_message"] = llm_message
        except Exception as e:
            print(f"[BEHAVIOR] LLM explanation failed (using deterministic message): {e}")
            # Keep the deterministic coach_message already in metrics

        # 4. Build final output (only fields the frontend card needs)
        output = {
            "tilt_score": metrics["tilt_score"],
            "status": metrics["status"],
            "block_trade": metrics["block_trade"],
            "coach_message": metrics["coach_message"],
            "user_id": metrics["user_id"],
            "current_asset_context": metrics["current_asset_context"],
            "current_state": metrics["current_state"],
            "patterns": metrics["patterns"],
        }

        print(f"[BEHAVIOR] Output: tilt_score={output['tilt_score']}, status={output['status']}, "
              f"streak={output['current_state']['current_loss_streak']}, "
              f"trades_found={metrics.get('trade_count', 0)}")

        await event_queue.enqueue_event(new_agent_text_message(json.dumps(output, ensure_ascii=False)))

    async def cancel(self, context, event_queue):
        pass


# ============================
# A2A Server Setup
# ============================

port = int(os.getenv("BEHAVIOR_AGENT_PORT", 9025))

skill = AgentSkill(
    id="behavior_agent",
    name="Behavior Psychologist",
    description="Analyzes trader psychology for Tilt and Risk using real trade history from database",
    tags=["psychology", "risk", "behavior", "tilt"],
    examples=["Check my behavior", "Am I tilting?", "Risk analysis", "Analyze behavior for Bad_Trader"],
)

public_agent_card = AgentCard(
    name="Behavior Agent",
    description="Analyzes trader psychology and history using real database data.",
    url=f"http://localhost:{port}/",
    version="2.0.0",
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    default_input_modes=["text"],
    default_output_modes=["text"],
)


def main():
    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=DefaultRequestHandler(BehaviorAgentExecutor(), InMemoryTaskStore()),
        extended_agent_card=public_agent_card,
    )
    print(f"[BEHAVIOR] Starting Behavior Agent on port {port}")
    print(f"[BEHAVIOR] Supabase URL: {SUPABASE_URL}")
    uvicorn.run(server.build(), host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
