from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.tools.agent_tool import AgentTool

# Import Sub-Agents (Standalone files now)
from .market_analysis_agent import market_analysis_agent
from .news_agent import news_agent
from .sentiment_agent import sentiment_agent
from .merge_agent import merge_agent
from .coach_agent import coach_agent
from .behavior_agent import behavior_agent

TRADER_COORDINATOR_PROMPT = """You are the TRADER COORDINATOR.

YOUR ROLE
You are the orchestrator for a team of specialized crypto trading sub-agents.
Your job is to route user requests to the correct agent or workflow.

AVAILABLE AGENTS:
1. **Market Analysis Agent**: Checks prices and technical indicators (RSI, MACD).
2. **News Agent**: Finds catalysts and news sources.
3. **Sentiment Agent**: Analyzes social/news sentiment quality.
4. **Behavior Agent**: Analyzes psychology (FOMO, FUD) and biases.
5. **Coach Agent**: Provides educational and risk management advice (no signals).
6. **Merge Agent**: Synthesizes ALL of the above into a final report.

WORKFLOWS:
1. **Real-Time Analysis Workflow** (Sequential):
   - Use this when the user asks "Analyze BTC", "Why is ETH dumping?", "Full report".
   - This runs Market -> News -> Sentiment -> Behavior -> Merge in order.
   - Triggers: "Analyze", "Deep Dive", "Report".

2. **Direct Agent Calls**:
   - "Price?" -> Call Market Analysis directly.
   - "Any news?" -> Call News Agent directly.
   - "Sentiment?" -> Call Sentiment directly.
   - "Is this FOMO?" -> Call Behavior Agent directly.
   - "Is 100x leverage safe?" -> Call Coach Agent directly.

RULES:
- If use asks for a "Full Report" or comprehensive analysis, ALWAYS delegate to the `real_time_market_workflow` (or call agents in sequence and then Merge).
- Do NOT answer market questions yourself. You are a router.
"""

# 1. Define the Full Real-Time Analysis Workflow (Sequential)
# The user requested a strict sequential flow: Market -> News -> Sentiment -> Behavior -> Merge.
real_time_workflow = SequentialAgent(
    name="real_time_market_workflow",
    sub_agents=[
        market_analysis_agent, 
        news_agent, 
        sentiment_agent, 
        behavior_agent, # Kept to satisfy MergeAgent inputs
        merge_agent
    ],
    description="Runs a step-by-step crypto analysis: Market Data -> News -> Sentiment -> Behavior -> Final Report."
)

# 2. The Root Coordinator Agent
trader_coordinator = LlmAgent(
    name="trader_coordinator",
    model="gemini-2.5-pro",
    instruction=TRADER_COORDINATOR_PROMPT,
    tools=[
        AgentTool(market_analysis_agent),
        AgentTool(news_agent),
        AgentTool(sentiment_agent),
        AgentTool(merge_agent),
        AgentTool(coach_agent),
        AgentTool(behavior_agent),
    ] 
)

root_agent = trader_coordinator
