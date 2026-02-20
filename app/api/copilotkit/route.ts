/**
 * CopilotKit API Route with A2A Middleware
 *
 * Sets up the connection between:
 * - Frontend (CopilotKit) → A2A Middleware → Orchestrator → A2A Agents
 *
 * KEY CONCEPTS:
 * - AG-UI Protocol: Agent-UI communication (CopilotKit ↔ Orchestrator)
 * - A2A Protocol: Agent-to-agent communication (Orchestrator ↔ Specialized Agents)
 * - A2A Middleware: Injects send_message_to_a2a_agent tool to bridge AG-UI and A2A
 */

import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { A2AMiddlewareAgent } from "@ag-ui/a2a-middleware";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // STEP 1: Define A2A agent URLs
  // STEP 1: Define A2A agent URLs
  const marketAgentUrl = process.env.MARKET_AGENT_URL || "http://localhost:9020";
  const newsAgentUrl = process.env.NEWS_AGENT_URL || "http://localhost:9021";
  const sentimentAgentUrl = process.env.SENTIMENT_AGENT_URL || "http://localhost:9022";
  const mergeAgentUrl = process.env.MERGE_AGENT_URL || "http://localhost:9023";
  const itineraryAgentUrl = process.env.ITINERARY_AGENT_URL || "http://localhost:9001";
  const budgetAgentUrl = process.env.BUDGET_AGENT_URL || "http://localhost:9002";
  const restaurantAgentUrl = process.env.RESTAURANT_AGENT_URL || "http://localhost:9003";
  const weatherAgentUrl = process.env.WEATHER_AGENT_URL || "http://localhost:9005";
  const behaviorAgentUrl = process.env.BEHAVIOR_AGENT_URL || "http://localhost:9025";
  const coachAgentUrl = process.env.COACH_AGENT_URL || "http://localhost:9026";
  // STEP 2: Define orchestrator URL (speaks AG-UI Protocol)
  const orchestratorUrl = process.env.ORCHESTRATOR_URL || "http://localhost:9000";

  // STEP 3: Wrap orchestrator with HttpAgent (AG-UI client)
  const orchestrationAgent = new HttpAgent({
    url: orchestratorUrl,
  });

  // STEP 4: Create A2A Middleware Agent
  const a2aMiddlewareAgent = new A2AMiddlewareAgent({
    description:
      "Travel planning with Trading assistant with 5 specialized agents.",

    agentUrls: [
      marketAgentUrl,
      newsAgentUrl,
      sentimentAgentUrl,
      mergeAgentUrl, // Added Merge Agent
      // itineraryAgentUrl,
      // restaurantAgentUrl,
      // budgetAgentUrl,
      // weatherAgentUrl,
      behaviorAgentUrl, // Added Behavior Agent
      coachAgentUrl, // Added Coach Agent
    ],

    orchestrationAgent,

    // Workflow instructions (middleware auto-adds routing info)
    instructions: `
      You are a unified assistant for High-Frequency Crypto Trading and Analysis.
      Your goal is to provide institutional-grade market analysis using a team of specialized agents.

      AVAILABLE AGENTS:
      - Market Analysis Agent (ADK): Provides technical analysis (RSI, MACD) for BTC/ETH
      - News Agent (ADK): Scrapes news and investigates market catalysts for BTC/ETH
      - Sentiment Agent (ADK): Analyzes market sentiment and social volume for BTC/ETH
      - Merge Agent (ADK): Synthesizes Market, News, and Sentiment data into a final verdict/signal
      - Behavior Agent (ADK): An analyst that says "The market just did X, and based on your history, you tend to Y in these situations". Analyzes trader psychology, tilt risk, loss streaks, and toxic asset patterns.
      - Crypto Coach Agent (ADK): Provides trading mentorship and generates viral market visuals with embedded price data.

      WORKFLOW STRATEGY:

      IF USER ASKS "WHY?", "EXPLAIN", "SHOULD I BUY?", "FULL ANALYSIS":
      Execute the "Synthesis Workflow" explicitly in this order:
      1. Market Analysis Agent -> Get Technicals.
      2. News Agent -> Get Fundamental Reasons/Catalysts (using context from Step 1).
      3. Sentiment Agent -> Get Crowd Psychology (using context from Step 1 & 2).
      4. Merge Agent -> Final Verdict.
         * CRITICAL: Pass the JSON outputs/summaries from Market, News, and Sentiment agents to the Merge Agent.
         * The Merge Agent will produce the final "Buy/Sell/Hold" signal card.

      IF USER ASKS FOR CONTENT OR ADVICE ("Post", "Tweet", "Visual", "Advice"):
      - Call Crypto Coach Agent.
        * Task: "Generate content/advice based on user request."

      IF USER ASKS SPECIFIC QUESTIONS:
      - "Price of BTC?" -> Market Analysis Agent.
      - "Any news on ETH?" -> News Agent.
      - "Sentiment on BTC?" -> Sentiment Agent.
      - "Check my behavior" or "Am I tilting?" -> Behavior Agent. ALWAYS include "user_id=<THE_USER_ID>" in your task message.
      - "Create a post" or "Generate visual" or "Need trading advice" -> Crypto Coach Agent.
         * Crypto Coach Agent can create Telegram posts or Twitter alerts with dramatic AI-generated images
         * Use for: mentorship, risk management advice, content creation

      CRITICAL RULES:
      - Call tools/agents ONE AT A TIME.
      - WAIT for the result before making the next call.
      - Do NOT hallucinate agent outputs.
      - Always ensure the Merger Agent is called last for complex queries to provide the summary card.
      - When calling Behavior Agent, ALWAYS pass the user_id (e.g., "Analyze behavior for user_id=Good_Trader"). The user_id is available in the conversation context.
    `,
  });

  // STEP 5: Create CopilotKit Runtime
  const runtime = new CopilotRuntime({
    agents: {
      a2a_chat: a2aMiddlewareAgent, // Must match frontend: <CopilotKit agent="a2a_chat">
    },
  });

  // STEP 6: Set up Next.js endpoint handler
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(request);
}
