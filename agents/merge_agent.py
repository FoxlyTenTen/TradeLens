"""
Merge Agent (ADK + A2A Protocol)
Synthesizes inputs from Market, News, and Sentiment agents.
"""
import uvicorn
import os
import json
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from typing import List, Dict, Any

load_dotenv()

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
from google.genai import types

# --- Constants & Prompts ---

MERGE_AGENT_PROMPT = """
You are the MERGE AGENT.

YOUR JOB
Synthesize three agent outputs into a single beginner-friendly result:
- Market Analysis Agent output (technical)
- News Agent output (catalysts + reliability)
- Sentiment Agent output (crowd + attention + extremes)

You do NOT fetch data. You ONLY use the inputs provided in the user message.
If any input is missing/invalid JSON, still output valid JSON and mark missing sections.

NO FINANCIAL ADVICE.
No buy/sell. No entry/exit. No “guaranteed”. Use cautious language.

--------------------------------------------------------------------------------
INPUT YOU WILL RECEIVE
User message typically includes labeled JSON blocks:
market_report: {
  "score": -100 to +100,
  "signal": "HARD BUY", "SOFT BUY", "HOLD", etc.,
  "components": { "liquidity":..., "trend":..., "momentum":..., "volatility":... },
  "explanation": "..."
}
news_report: {...}
sentiment_report: {...}
user_question: "..."

If labels are missing, infer best-effort.

--------------------------------------------------------------------------------
TWO MODES

MODE 1: BEGINNER SUMMARY (DEFAULT)
Trigger examples:
- "Why bullish?"
- "Explain simply"
- "So what does it mean?"
- Any normal user question that is not explicitly asking for a full report

Goal:
- Produce a SMALL, EASY UI output with minimal cards.
- Keep it short, consistent, and understandable.

OUTPUT SHAPE: MergeSummaryV1 (STRICT JSON)

Example JSON (structure you MUST follow):

{
  "asset": "BTC-USD",
  "timeframe": "short-term",

  "headline": "Mixed signals: narrative and sentiment support, but technical confirmation is still missing.",
  "bias": "Cautious",
  "confidence": "Medium",
  "signal_color": "yellow",

  "why": [
    "Technicals: momentum is not clearly bullish yet.",
    "News: catalyst looks supportive (reliability High).",
    "Sentiment: crowd is optimistic; attention is rising."
  ],

  "what_to_watch": [
    "Technical confirmation (momentum improves and holds).",
    "Follow-through: news stays credible and attention doesn’t fade."
  ],

  "risk_flag": "If optimism stays high without technical follow-through, pullback risk increases."
}

Hard limits (Mode 1):
- headline: max 1 sentence
- why: exactly 3 bullets, always in this order: Technical, News, Sentiment
- what_to_watch: exactly 2 bullets
- risk_flag: max 1 sentence
- No numbers unless extremely necessary (beginner mode)

MODE 2: FULL REPORT (STRICT JSON)
Trigger examples:
- "Full report"
- "Detailed synthesis"
- "Export report"
- "Mode 2"
- "Give me everything"

OUTPUT SHAPE: MergeReportV2 (STRICT JSON)
Return ONLY valid JSON following this exact structure:

{
  "asset": "BTC-USD",
  "timeframe": "short-term",
  "verdict": {
    "bias": "Bullish",
    "confidence": "Medium",
    "confidence_score": 68,
    "signal_color": "yellow"
  },
  "main_thesis": "Technicals are mixed while news and sentiment are supportive; confirmation is still needed.",
  "agreement_summary": [
    "News reliability is High/Medium and broadly supportive.",
    "Sentiment and attention are elevated, which can amplify moves."
  ],
  "conflicts": [
    {
      "topic": "Momentum vs narrative",
      "what_conflicts": "Technical momentum is weaker than the positive narrative/sentiment.",
      "why_it_matters": "Narrative-led moves can fade without technical confirmation."
    }
  ],
  "component_breakdown": {
    "technical": {
      "stance": "Neutral",
      "evidence": ["RSI is elevated", "MACD is not clearly confirming"],
      "watch": "Look for momentum improvement and holding above key levels."
    },
    "news": {
      "stance": "Bullish",
      "reliability": "High",
      "evidence": ["Primary source is High reliability"],
      "watch": "Watch for follow-up confirmations from credible outlets."
    },
    "sentiment": {
      "stance": "Bullish",
      "extreme_state": "Elevated",
      "contrarian_risk": "Medium",
      "evidence": ["Sentiment rising", "Social volume rising"],
      "watch": "If volume fades while sentiment stays high, the narrative may be weakening."
    }
  },
  "key_levels": {
    "support": 40500.0,
    "resistance": 43500.0,
    "notes": "Use market_report key levels; if missing derive from Bollinger bands or set null."
  },
  "key_risks": [
    "Conflict between technicals and narrative/sentiment.",
    "Elevated sentiment can increase pullback risk."
  ],
  "invalidation": [
    {
      "condition": "If technical momentum turns bullish and holds above resistance.",
      "impact": "Confidence increases and verdict shifts more bullish."
    },
    {
      "condition": "If price weakens toward support while attention fades.",
      "impact": "Confidence drops and verdict shifts cautious/bearish."
    }
  ],
  "what_to_watch_next": [
    {
      "focus": "Technical confirmation",
      "signal": "Momentum improves and holds",
      "why": "Reduces conflict and supports the narrative."
    },
    {
      "focus": "Narrative follow-through",
      "signal": "More credible confirmations + sustained attention",
      "why": "Suggests catalyst is not a one-off headline."
    }
  ],
  "display_hints": {
    "ui_message": "Mixed signals: supportive narrative, but confirmation still needed.",
    "badge_labels": ["conflict", "watch confirmation"]
  }
}

STRICT RULES FOR MODE 2:
- Output MUST be raw JSON only.
- Use ONLY the provided agent inputs; do NOT invent facts.
- If a field is missing, use null/"missing" and explain in notes.

"""


# --- Agent Class ---
class MergeAgent:
    def __init__(self):
        self._agent = self._build_agent()
        self._user_id = 'remote_agent'
        
        self._runner = Runner(
            app_name=self._agent.name,
            agent=self._agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )

    def _build_agent(self) -> LlmAgent:
        model_name = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')
        
        return LlmAgent(
            name="merge_agent",
            model=model_name,
            instruction=MERGE_AGENT_PROMPT,
            description="Synthesizes Market, News, and Sentiment data into a final verdict.",
            tools=[], # Pure logic agent, processing provided context
            output_key="merge_agent_results"
        )

    async def invoke(self, query: str, session_id: str) -> str:
        # Standard ADK invocation pattern
        session = await self._runner.session_service.get_session(
            app_name=self._agent.name, user_id=self._user_id, session_id=session_id
        )
        content = types.Content(role='user', parts=[types.Part.from_text(text=query)])
        
        if not session:
                session = await self._runner.session_service.create_session(
                app_name=self._agent.name, user_id=self._user_id, state={}, session_id=session_id
            )

        response_text = ''
        async for event in self._runner.run_async(user_id=self._user_id, session_id=session.id, new_message=content):
            if event.is_final_response() and event.content:
                response_text = getattr(event.content.parts[0], 'text', '')
                break
        
        # Clean JSON if necessary
        content_str = response_text.strip()
        if "```json" in content_str:
            content_str = content_str.split("```json")[1].split("```")[0].strip()
        elif "```" in content_str:
            content_str = content_str.split("```")[1].split("```")[0].strip()
            
        return content_str

# --- Server Setup ---
port = int(os.getenv("MERGE_AGENT_PORT", 9023))

skill = AgentSkill(
    id='merge_agent',
    name='Strategy Synthesizer',
    description='Merges multi-agent insights',
    tags=['crypto', 'strategy', 'merge'],
    examples=['Synthesize this data...'],
)

public_agent_card = AgentCard(
    name='Merge Agent',
    description='Synthesizes insights from Market, News, and Sentiment agents.',
    url=f'http://localhost:{port}/',
    version='1.0.0',
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    default_input_modes=['text'],
    default_output_modes=['text']
)

class MergeAgentExecutor(AgentExecutor):
    def __init__(self):
        self.agent = MergeAgent()
    
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        result = await self.agent.invoke(context.get_user_input(), getattr(context, 'context_id', 'default'))
        await event_queue.enqueue_event(new_agent_text_message(result))

    async def cancel(self, context, event_queue): pass

def main():
    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=DefaultRequestHandler(MergeAgentExecutor(), InMemoryTaskStore()),
        extended_agent_card=public_agent_card,
    )
    print(f"Starting Merge Agent on port {port}")
    uvicorn.run(server.build(), host='0.0.0.0', port=port)

if __name__ == '__main__':
    main()
