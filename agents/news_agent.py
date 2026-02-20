"""
News Agent (ADK + A2A Protocol) - SINGLE FILE (No separate FastAPI)

What this version fixes (your "not real-time" problem):
- GDELT sorted by newest first (DateDesc) instead of HybridRel
- No longer throws away fresh headlines just because extraction fails (paywalls/JS sites)
- Stronger recency scoring (latest wins)
- Domain normalization (www. vs non-www)
- Cache TTL reduced + optional force_refresh
- Rate-limit handled by waiting (async sleep) instead of returning stale/429 immediately

Run:
  python news_agent.py

Env:
  GEMINI_MODEL=gemini-2.0-flash
  NEWS_AGENT_PORT=9021
  NEWS_HOURS_BACK=6
"""

import uvicorn
import os
import json
import time
import re
import asyncio
from dotenv import load_dotenv
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timezone, timedelta

load_dotenv()

# -------------------------
# A2A Imports
# -------------------------
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.utils import new_agent_text_message

# -------------------------
# ADK Imports
# -------------------------
from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.artifacts import InMemoryArtifactService
from google.genai import types

# -------------------------
# Networking + extraction
# -------------------------
import httpx
import trafilatura


# =========================
# GDELT + Extract (embedded)
# =========================
GDELT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc"
USER_AGENT = "CryptoNewsAgent/2.0"

# Rate limit (GDELT: 1 request per 5s). Add buffer.
GDELT_COOLDOWN_SEC = 6
LAST_GDELT_CALL_TS = 0.0

# Cache (keep short if you want "real-time")
CACHE_TTL_SEC = 15
CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}

# Defaults (real-time vibe)
DEFAULT_HOURS_BACK = int(os.getenv("NEWS_HOURS_BACK", "6"))
DEFAULT_MAX_RECORDS = int(os.getenv("NEWS_MAX_RECORDS", "80"))
DEFAULT_MAX_ITEMS = int(os.getenv("NEWS_MAX_ITEMS", "25"))
DEFAULT_MAX_EXTRACT = int(os.getenv("NEWS_MAX_EXTRACT", "6"))

# Ranking config (normalize domains; don't include www.)
REPUTABLE_DOMAINS = {
    "finance.yahoo.com",
    "reuters.com",
    "bloomberg.com",
    "cnbc.com",
    "wsj.com",
    "ft.com",
    "coindesk.com",
    "cointelegraph.com",
    "bitcoinmagazine.com",
    "fxstreet.com",
}

IMPACT_KEYWORDS = [
    "etf", "inflow", "outflow", "sec", "fed", "cpi", "inflation", "rates",
    "jobs", "nonfarm", "payroll", "nfp",
    "hack", "exploit", "breach", "outage",
    "lawsuit", "regulation", "ban", "probe",
    "liquidation", "funding", "leverage",
    "custody", "institution", "treasury", "reserve",
]

CATEGORY_MAP = [
    ("etf", "ETF"), ("inflow", "ETF"), ("outflow", "ETF"),
    ("sec", "Regulation"), ("regulation", "Regulation"), ("lawsuit", "Regulation"), ("ban", "Regulation"), ("probe", "Regulation"),
    ("fed", "Macro"), ("cpi", "Macro"), ("inflation", "Macro"), ("rates", "Macro"),
    ("jobs", "Macro"), ("nonfarm", "Macro"), ("payroll", "Macro"), ("nfp", "Macro"),
    ("hack", "Hack"), ("exploit", "Hack"), ("breach", "Hack"), ("outage", "Hack"),
    ("liquidation", "Derivatives"), ("funding", "Derivatives"), ("leverage", "Derivatives"),
    ("custody", "Institutional"), ("institution", "Institutional"), ("treasury", "Institutional"), ("reserve", "Institutional"),
]

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _fmt_gdelt_dt(dt: datetime) -> str:
    return dt.strftime("%Y%m%d%H%M%S")

def _parse_gdelt_ts(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    # Common GDELT formats vary (be defensive)
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y%m%d%H%M%S"):
        try:
            dt = datetime.strptime(ts, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            continue
    return None

def _norm_domain(d: Optional[str]) -> str:
    d = (d or "").lower().strip()
    if d.startswith("www."):
        d = d[4:]
    return d

def _build_query(symbol: str) -> str:
    s = (symbol or "").upper().strip()
    if s.startswith("BTC"):
        return '(bitcoin OR btc OR "BTCUSD")'
    if s.startswith("ETH"):
        return '(ethereum OR eth OR "ETHUSD")'
    return f'("{s}")'

def _impact_hits(title: str, summary: str) -> int:
    t = f"{title} {summary}".lower()
    return sum(1 for k in IMPACT_KEYWORDS if k in t)

def _infer_category(title: str, summary: str) -> str:
    t = f"{title} {summary}".lower()
    for k, cat in CATEGORY_MAP:
        if k in t:
            return cat
    if any(x in t for x in ["support", "resistance", "rsi", "macd", "fib", "breakout", "price", "levels"]):
        return "Price Action"
    return "Market Overview"

def _infer_type(domain: Optional[str]) -> str:
    d = _norm_domain(domain)
    return "Major Media" if d in REPUTABLE_DOMAINS else "Analytics"

def _reliability(domain: Optional[str], extraction_ok: bool, hits: int) -> Dict[str, str]:
    d = _norm_domain(domain)
    if d in REPUTABLE_DOMAINS and extraction_ok:
        return {"rating": "High", "reason": "Reputable publisher and content was readable/extractable."}
    if d in REPUTABLE_DOMAINS and hits >= 2:
        return {"rating": "High", "reason": "Reputable publisher + strong catalyst keywords (even if content extraction is limited)."}
    if d in REPUTABLE_DOMAINS:
        return {"rating": "Medium", "reason": "Reputable publisher, but details are limited (likely paywall/JS) or catalyst signal is weaker."}
    if extraction_ok and hits >= 2:
        return {"rating": "Medium", "reason": "Readable content + multiple catalyst keywords, but source is less established."}
    return {"rating": "Low", "reason": "Weak signal and/or low-confidence source and/or blocked extraction."}

def _quick_summary(text: str, max_sentences: int = 3, max_chars: int = 450) -> str:
    if not text:
        return ""
    text = " ".join(text.split()).strip()
    sentences = re.split(r"(?<=[.!?])\s+", text)
    out = " ".join(sentences[:max_sentences]).strip()
    if len(out) > max_chars:
        out = out[:max_chars].rstrip() + "…"
    return out

async def _extract_article(url: str) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            r = await client.get(url)
            r.raise_for_status()
            html = r.text

        extracted_json = trafilatura.extract(
            html,
            output_format="json",
            with_metadata=True,
            favor_precision=True,
        )
        if not extracted_json:
            return {"ok": False, "reason": "trafilatura_extract_null"}

        meta = json.loads(extracted_json)
        text = (meta.get("text") or "").strip()

        return {
            "ok": True,
            "extracted_title": meta.get("title"),
            "sitename": meta.get("sitename"),
            "date": meta.get("date"),
            "text": text,
            "text_len": len(text),
            "summary": _quick_summary(text),
        }
    except httpx.HTTPStatusError as e:
        return {"ok": False, "reason": "http_error", "status": e.response.status_code}
    except httpx.RequestError as e:
        return {"ok": False, "reason": "network_error", "detail": str(e)}
    except Exception as e:
        return {"ok": False, "reason": "unknown_error", "detail": str(e)}

async def _gdelt_fetch(symbol: str, hours_back: int, max_records: int) -> Dict[str, Any]:
    """
    Fetch from GDELT, newest first.
    We *wait* for cooldown instead of returning stale/429 instantly.
    """
    global LAST_GDELT_CALL_TS

    now = time.time()
    wait = (LAST_GDELT_CALL_TS + GDELT_COOLDOWN_SEC) - now
    if wait > 0:
        await asyncio.sleep(wait)

    query = _build_query(symbol)
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(hours=hours_back)

    params = {
        "query": query,
        "mode": "ArtList",
        "format": "json",
        # IMPORTANT: newest first (this is the "real-time" fix)
        "sort": "DateDesc",
        "maxrecords": str(max_records),
        "startdatetime": _fmt_gdelt_dt(start_dt),
        "enddatetime": _fmt_gdelt_dt(end_dt),
    }

    async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": USER_AGENT}) as client:
        r = await client.get(GDELT_DOC, params=params)
        LAST_GDELT_CALL_TS = time.time()

        if "Please limit requests to one every 5 seconds" in (r.text or ""):
            return {"error": {"status_code": 429, "detail": "Rate-limited by GDELT (1 req / 5s)."}}

        r.raise_for_status()
        data = r.json()

    return {"query": query, "data": data}

def _score_item(item: Dict[str, Any]) -> float:
    """
    Realtime-first scoring:
    - recency dominates
    - reputable domain boosts
    - extraction helps but is NOT required
    - impact keywords add signal
    """
    title = (item.get("title") or "").strip()
    domain = _norm_domain(item.get("domain"))
    published_at = item.get("published_at")
    dt = _parse_gdelt_ts(published_at)

    extraction = item.get("extraction") or {}
    ok = bool(extraction.get("ok"))
    summary = (extraction.get("summary") or "").strip()

    hits = _impact_hits(title, summary)
    score = 0.0

    # 1) RECENCY (dominate)
    # Strongly prefer last 3 hours; still okay up to 24h.
    if dt:
        age_min = max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 60.0)
        # +10 in first 3h, decays to 0
        score += max(0.0, 10.0 * (1.0 - min(1.0, age_min / 180.0)))
        # small extra decay up to 24h
        score += max(0.0, 2.0 * (1.0 - min(1.0, age_min / (24.0 * 60.0))))
    else:
        # Unknown time = penalize a bit
        score -= 1.0

    # 2) DOMAIN credibility
    if domain in REPUTABLE_DOMAINS:
        score += 4.0
    elif domain:
        score += 1.0

    # 3) EXTRACTION (bonus only)
    if ok:
        score += 2.0
        if len(summary) >= 150:
            score += 1.0

    # 4) IMPACT keywords
    score += min(6.0, hits * 1.3)

    return score

async def get_top_news(
    symbol: str,
    hours_back: int = DEFAULT_HOURS_BACK,
    max_records: int = DEFAULT_MAX_RECORDS,
    max_items: int = DEFAULT_MAX_ITEMS,
    max_extract: int = DEFAULT_MAX_EXTRACT,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """
    Tool for the LLM:
    - fetch GDELT (newest-first)
    - try extract for first N items (helps summaries)
    - rank & return top3 (headline-only allowed)
    """
    sym = (symbol or "").upper().strip() or "BTCUSD"
    cache_key = f"{sym}|{hours_back}|{max_records}|{max_items}|{max_extract}"

    cached = CACHE.get(cache_key)
    if (not force_refresh) and cached and (time.time() - cached[0] <= CACHE_TTL_SEC):
        return {**cached[1], "cached": True}

    fetched = await _gdelt_fetch(sym, hours_back, max_records)
    if fetched.get("error"):
        # Serve cache if exists
        if cached:
            return {**cached[1], "cached": True, "note": "Served cache due to GDELT rate-limit."}
        return {
            "symbol": sym,
            "query": _build_query(sym),
            "top3": [],
            "count_top3": 0,
            "source_count": 0,
            "cached": False,
            "generated_at": _utc_now_iso(),
            "error": fetched["error"],
        }

    data = fetched["data"]
    raw_articles = data.get("articles") or []

    items: List[Dict[str, Any]] = []
    for a in raw_articles:
        url = a.get("url")
        title = a.get("title")
        if url and title:
            items.append({
                "title": title.strip(),
                "url": url,
                # GDELT often uses seendate like 20260211TxxxxZ
                "published_at": a.get("seendate") or a.get("date"),
                "domain": _norm_domain(a.get("domain")),
                "extraction": {"ok": False},  # default
            })
        if len(items) >= max_items:
            break

    # Extract content for first max_extract items (best effort)
    targets = items[:max_extract]
    if targets:
        results = await asyncio.gather(*[_extract_article(x["url"]) for x in targets])
        for i, ext in enumerate(results):
            items[i]["extraction"] = ext

    # Filter: Drop dead links (404/DNS/Timeout), but KEEP valid links even if extraction partial/empty
    valid_items = []
    for it in items:
        ext = it.get("extraction", {})
        # Only keep items we actually checked (attempted extraction) and that are reachable
        # Unchecked items (extraction={'ok': False} with no reason) are dropped to avoid 404 risk
        if ext.get("ok") or ext.get("reason") == "trafilatura_extract_null":
            valid_items.append(it)

    # Rank valid items
    scored = sorted(((_score_item(it), it) for it in valid_items), key=lambda x: x[0], reverse=True)
    top3 = [x[1] for x in scored[:3]]

    out = {
        "symbol": sym,
        "query": fetched.get("query", ""),
        "top3": top3,
        "count_top3": len(top3),
        "source_count": len(items),
        "cached": False,
        "generated_at": _utc_now_iso(),
        "error": None,
    }

    CACHE[cache_key] = (time.time(), out)
    return out


# =========================
# Prompt: strict JSON output
# =========================
NEWS_AGENT_PROMPT = """
You are the NEWS AGENT (LIVE MODE, SINGLE FILE).

SOURCE OF TRUTH
You MUST call the tool `get_top_news(symbol, hours_back, max_records, max_items, max_extract, force_refresh)` exactly once.
You DO NOT browse the web directly.
You DO NOT invent titles, urls, timestamps, or publisher names.

RESTRICTION: ONLY handle BTC or ETH.
If unclear, default to BTC.
- BTC -> symbol "BTCUSD"
- ETH -> symbol "ETHUSD"

GOAL
Pick only the TOP 3 most market-relevant news items and explain what happened.
Prefer the LATEST items.

MANDATORY STEPS
1) Decide symbol:
   - BTC/Bitcoin -> BTCUSD
   - ETH/Ethereum -> ETHUSD
   - else BTCUSD
2) Call get_top_news("BTCUSD" or "ETHUSD", hours_back=6, max_records=80, max_items=25, max_extract=6, force_refresh=true) exactly once.
3) If tool returns error or top3 empty:
   - Return STRICT fallback JSON:
     {
       "asset": "BTC",
       "catalyst_summary": "No significant market-moving news found.",
       "what_happened": "No reliable news sources found in the last 6h.",
       "why_it_matters": "N/A",
       "causality_note": "N/A",
       "reliability": { "rating": "Low", "reason": "No valid sources found." },
       "sources": {
         "primary": { "title": "No News Found", "url": "", "published_at": "", "source_name": "N/A", "type": "N/A", "category": "N/A", "confirmations": 0 },
         "supporting": []
       },
       "key_quote": { "quote": "", "context": "" },
       "what_to_watch": []
     }
4) Else:
   - primary = top3[0]
   - supporting = remaining top3 items (max 2)
   - Return STRICT JSON in the exact schema below.

OUTPUT: JSON ONLY. No markdown, no extra text. First char { last char }.

REQUIRED JSON SHAPE (DO NOT CHANGE KEYS)
{
  "asset": "BTC",
  "catalyst_summary": "...",
  "what_happened": "...",
  "why_it_matters": "...",
  "causality_note": "...",
  "reliability": { "rating": "High|Medium|Low", "reason": "..." },
  "sources": {
    "primary": {
      "title": "...",
      "url": "...",
      "published_at": "...",
      "source_name": "...",
      "type": "...",
      "category": "...",
      "confirmations": 0
    },
    "supporting": [
      {
        "title": "...",
        "url": "...",
        "published_at": "...",
        "source_name": "...",
        "type": "...",
        "category": "...",
        "reliability": "High|Medium|Low"
      }
    ]
  },
  "key_quote": { "quote": "", "context": "" },
  "what_to_watch": [
    { "signal": "...", "why": "..." },
    { "signal": "...", "why": "..." }
  ]
}

MAPPING RULES (use tool output only)
Tool output fields:
- symbol: "BTCUSD"/"ETHUSD"
- top3: list with title,url,published_at,domain,extraction(optional)

asset:
- "BTC" if tool.symbol starts with BTC else "ETH" if starts with ETH

Primary:
- sources.primary.title <- primary.title
- sources.primary.url <- primary.url
- sources.primary.published_at <- primary.published_at
- sources.primary.source_name <- primary.domain (use domain only, never invent)
- sources.primary.type <- "Major Media" if primary.domain is reputable else "Analytics"
- sources.primary.category <- infer from primary.title and (primary.extraction.summary if exists else "")
- sources.primary.confirmations <- 1

Supporting:
- include only remaining top3 items (0–2)
- set supporting.reliability based on domain + extraction.ok + catalyst keywords

Reliability object:
- based on PRIMARY only

Text fields:
- catalyst_summary: 1 sentence capturing the shared driver across the 3
- what_happened: 1 fact-only sentence from PRIMARY title (and summary if available)
- why_it_matters: 1–2 sentences mechanism in plain English
- causality_note: 1 sentence warning price moves are multi-factor
- key_quote: always empty
- what_to_watch: exactly 2 items: follow-through + confirmation/macro signals
"""


# =========================
# Agent Class
# =========================
class NewsAgent:
    def __init__(self):
        self._agent = self._build_agent()
        self._user_id = "remote_agent"

        self._runner = Runner(
            app_name=self._agent.name,
            agent=self._agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )

    def _build_agent(self) -> LlmAgent:
        model_name = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

        return LlmAgent(
            name="news_agent",
            model=model_name,
            instruction=NEWS_AGENT_PROMPT,
            description="Single-file LIVE News Agent (Top 3) with embedded GDELT + extraction.",
            tools=[get_top_news],
            output_key="news_agent_results",
        )

    async def invoke(self, query: str, session_id: str) -> str:
        session = await self._runner.session_service.get_session(
            app_name=self._agent.name, user_id=self._user_id, session_id=session_id
        )
        content = types.Content(role="user", parts=[types.Part.from_text(text=query)])

        if not session:
            session = await self._runner.session_service.create_session(
                app_name=self._agent.name, user_id=self._user_id, state={}, session_id=session_id
            )

        response_text = ""
        async for event in self._runner.run_async(
            user_id=self._user_id, session_id=session.id, new_message=content
        ):
            if event.is_final_response() and event.content:
                response_text = getattr(event.content.parts[0], "text", "")
                break

        content_str = (response_text or "").strip()
        if "```json" in content_str:
            content_str = content_str.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in content_str:
            content_str = content_str.split("```", 1)[1].split("```", 1)[0].strip()

        return content_str


# =========================
# Server Setup
# =========================
port = int(os.getenv("NEWS_AGENT_PORT", 9021))

skill = AgentSkill(
    id="news_agent",
    name="News Hunter",
    description="Investigates BTC/ETH market news (single-file). Selects top 3 and explains market context.",
    tags=["crypto", "news", "research", "investigation"],
    examples=["Why is BTC down?", "News on ETH", "What happened to Bitcoin today?"],
)

public_agent_card = AgentCard(
    name="News Agent",
    description="BTC/ETH news agent (single-file). Embedded GDELT + extraction + top 3 selection.",
    url=f"http://localhost:{port}/",
    version="4.0.0",
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    default_input_modes=["text"],
    default_output_modes=["text"],
)

class NewsAgentExecutor(AgentExecutor):
    def __init__(self):
        self.agent = NewsAgent()

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        result = await self.agent.invoke(
            context.get_user_input(),
            getattr(context, "context_id", "default"),
        )
        await event_queue.enqueue_event(new_agent_text_message(result))

    async def cancel(self, context, event_queue):
        pass

def main():
    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=DefaultRequestHandler(NewsAgentExecutor(), InMemoryTaskStore()),
        extended_agent_card=public_agent_card,
    )
    print(f"Starting News Agent (SINGLE FILE) on port {port}")
    uvicorn.run(server.build(), host="0.0.0.0", port=port)

if __name__ == "__main__":
    main()

