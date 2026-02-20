"use client";

/**
 * Travel Chat Component
 *
 * Demonstrates key patterns:
 * - A2A Communication: Visualizes message flow between orchestrator and agents
 * - HITL: Trip requirements form and budget approval workflows
 * - Generative UI: Extracts structured data from agent responses
 * - Multi-Agent: Coordinates 4 agents across LangGraph + ADK via A2A Protocol
 */

import React, { useState, useEffect } from "react";
import { CopilotKit, useCopilotChat, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useCopilotAction } from "@copilotkit/react-core";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { MarketCard } from "./MarketCard";
import { MergeCard } from "./MergeCard";
import { BehaviorCard } from "./BehaviorCard";
import type {
  TravelChatProps,
  ItineraryData,
  BudgetData,
  WeatherData,
  RestaurantData,
  MarketData,
  NewsData,
  SentimentData,
  MergeData,
  BehaviorData,
  MessageActionRenderProps,
  CoachData,
} from "./types";
import { MessageToA2A } from "./a2a/MessageToA2A";
import { MessageFromA2A } from "./a2a/MessageFromA2A";
import { TripRequirementsForm } from "./forms/TripRequirementsForm";
import { BudgetApprovalCard } from "./hitl/BudgetApprovalCard";
import { WeatherCard } from "./WeatherCard";
import { NewsCard } from "./NewsCard";
import { SentimentCard } from "./SentimentCard";
import { CoachCard } from "./CoachCard";

const ChatInner = ({
  onItineraryUpdate,
  onBudgetUpdate,
  onWeatherUpdate,
  onRestaurantUpdate,
  onMarketUpdate,
  onNewsUpdate,
  onSentimentUpdate,
  onMergeUpdate,
  onBehaviorUpdate,
  onCoachUpdate,
}: TravelChatProps) => {
  const [approvalStates, setApprovalStates] = useState<
    Record<string, { approved: boolean; rejected: boolean }>
  >({});
  const [customBuyValue, setCustomBuyValue] = useState("BTC");
  const { visibleMessages } = useCopilotChat();

  // --- Context for User ID ---
  const [userId, setUserId] = useState<string>("Good_Trader");

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Read initial value from localStorage
      const stored = localStorage.getItem("trade_database_selected_user");
      if (stored) setUserId(stored);

      // Handler for profile changes
      const syncUserId = () => {
        const updated = localStorage.getItem("trade_database_selected_user");
        if (updated && updated !== userId) {
          setUserId(updated);
          console.log(`[CHAT] Profile changed to: ${updated}`);
        }
      };

      // 'storage' fires for cross-tab changes
      window.addEventListener("storage", syncUserId);

      // Custom 'profileChanged' event fires for same-tab changes
      // (dispatched by Profile page when user selects a new profile)
      window.addEventListener("profileChanged", syncUserId);

      return () => {
        window.removeEventListener("storage", syncUserId);
        window.removeEventListener("profileChanged", syncUserId);
      };
    }
  }, [userId]);

  useCopilotReadable({
    description: "The active trading User ID. Pass this to agents when analyzing behavior or history.",
    value: userId,
  });

  // Extract structured data from A2A agent responses
  useEffect(() => {
    const extractDataFromMessages = () => {
      for (const message of visibleMessages) {
        const msg = message as any;

        if (msg.type === "ResultMessage" && msg.actionName === "send_message_to_a2a_agent") {
          try {
            const result = msg.result;
            let parsed;

            if (typeof result === "string") {
              let cleanResult = result;
              if (result.startsWith("A2A Agent Response: ")) {
                cleanResult = result.substring("A2A Agent Response: ".length);
              }
              parsed = JSON.parse(cleanResult);
            } else if (typeof result === "object" && result !== null) {
              parsed = result;
            }

            if (parsed) {
              if (parsed.destination && parsed.itinerary && Array.isArray(parsed.itinerary)) {
                onItineraryUpdate?.(parsed as ItineraryData);
              }
              else if (parsed.totalBudget && parsed.breakdown && Array.isArray(parsed.breakdown)) {
                const budgetKey = `budget-${parsed.totalBudget}`;
                const isApproved = approvalStates[budgetKey]?.approved || false;
                if (isApproved) {
                  onBudgetUpdate?.(parsed as BudgetData);
                }
              }
              else if (parsed.destination && parsed.forecast && Array.isArray(parsed.forecast)) {
                const weatherDataParsed = parsed as WeatherData;
                onWeatherUpdate?.(weatherDataParsed);
              }
              else if (parsed.destination && parsed.meals && Array.isArray(parsed.meals)) {
                onRestaurantUpdate?.(parsed as RestaurantData);
              }
              else if (parsed.symbol && parsed.price !== undefined && (parsed.components || parsed.indicators)) { // Detect Market Data
                onMarketUpdate?.(parsed as MarketData);
              }
              else if (parsed.catalyst_summary && parsed.sources?.primary) { // Detect News Data
                onNewsUpdate?.(parsed as NewsData);
              }
              else if (parsed.sentiment?.score !== undefined && parsed.asset) { // Detect Sentiment Data
                onSentimentUpdate?.(parsed as SentimentData);
              }
              else if (parsed.body && (parsed.platform || parsed.image_filename)) { // Detect Coach Data (has body + platform/image)
                onCoachUpdate?.(parsed as CoachData);
              }
              else if (parsed.headline && parsed.bias) { // Detect Merge Data (Mode 1)
                onMergeUpdate?.(parsed as MergeData);
              }
              else if (parsed.tilt_score !== undefined && parsed.status) { // Detect Behavior Data
                onBehaviorUpdate?.(parsed as any);
              }
            }
          } catch (e) {
          }
        }
      }
    };

    extractDataFromMessages();
  }, [
    visibleMessages,
    approvalStates,
    onItineraryUpdate,
    onBudgetUpdate,
    onWeatherUpdate,
    onRestaurantUpdate,
    onMarketUpdate,
    onNewsUpdate,
    onSentimentUpdate,
    onMergeUpdate,
    onBehaviorUpdate,
    onCoachUpdate,
  ]);

  // Register A2A message visualizer (renders green/blue communication boxes)
  useCopilotAction({
    name: "send_message_to_a2a_agent",
    description: "Sends a message to an A2A agent",
    available: "frontend",
    parameters: [
      {
        name: "agentName",
        type: "string",
        description: "The name of the A2A agent to send the message to",
      },
      {
        name: "task",
        type: "string",
        description: "The message to send to the A2A agent",
      },
    ],
    render: (actionRenderProps: MessageActionRenderProps) => {
      return (
        <>
          <MessageToA2A {...actionRenderProps} />
          <MessageFromA2A {...actionRenderProps} />
        </>
      );
    },
  });

  // Register HITL budget approval workflow (pauses agent until user approves/rejects)
  useCopilotAction(
    {
      name: "request_budget_approval",
      description: "Request user approval for the travel budget",
      parameters: [
        {
          name: "budgetData",
          type: "object",
          description: "The budget breakdown data requiring approval",
        },
      ],
      renderAndWaitForResponse: ({ args, respond }) => {
        if (!args.budgetData || typeof args.budgetData !== "object") {
          return <div className="text-xs text-gray-500 p-2">Loading budget data...</div>;
        }

        const budget = args.budgetData as BudgetData;

        if (!budget.totalBudget || !budget.breakdown) {
          return <div className="text-xs text-gray-500 p-2">Loading budget data...</div>;
        }

        const budgetKey = `budget-${budget.totalBudget}`;
        const currentState = approvalStates[budgetKey] || { approved: false, rejected: false };

        const handleApprove = () => {
          setApprovalStates((prev) => ({
            ...prev,
            [budgetKey]: { approved: true, rejected: false },
          }));
          respond?.({ approved: true, message: "Budget approved by user" });
        };

        const handleReject = () => {
          setApprovalStates((prev) => ({
            ...prev,
            [budgetKey]: { approved: false, rejected: true },
          }));
          respond?.({ approved: false, message: "Budget rejected by user" });
        };

        return (
          <BudgetApprovalCard
            budgetData={budget}
            isApproved={currentState.approved}
            isRejected={currentState.rejected}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        );
      },
    },
    [approvalStates]
  );

  // Register HITL trip requirements form (collects trip info at start)
  useCopilotAction({
    name: "gather_trip_requirements",
    description: "Gather trip requirements from the user (city, days, people, budget level)",
    parameters: [
      {
        name: "city",
        type: "string",
        description: "The destination city (may be pre-filled from user message)",
        required: false,
      },
      {
        name: "numberOfDays",
        type: "number",
        description: "Number of days for the trip (1-7)",
        required: false,
      },
      {
        name: "numberOfPeople",
        type: "number",
        description: "Number of people in the group (1-15)",
        required: false,
      },
      {
        name: "budgetLevel",
        type: "string",
        description: "Budget level: Economy, Comfort, or Premium",
        required: false,
      },
    ],
    renderAndWaitForResponse: ({ args, respond }) => {
      return <TripRequirementsForm args={args} respond={respond} />;
    },
  });

  // Display WeatherCard inline in chat (also shown in main content area)
  useCopilotAction({
    name: "display_weather_forecast",
    description: "Display weather forecast data as generative UI in the chat",
    available: "frontend",
    parameters: [
      {
        name: "weatherData",
        type: "object",
        description: "Weather forecast data to display",
      },
    ],
    render: ({ args }) => {
      if (!args.weatherData || typeof args.weatherData !== "object") {
        return <></>;
      }

      const weather = args.weatherData as WeatherData;

      if (!weather.destination || !weather.forecast || !Array.isArray(weather.forecast)) {
        return <></>;
      }

      return (
        <div className="my-3">
          <WeatherCard data={weather} />
        </div>
      );
    },
  });

  // Display MarketCard inline in chat
  useCopilotAction({
    name: "display_market_analysis",
    description: "Display crypto market analysis card in the chat",
    available: "frontend",
    parameters: [
      {
        name: "marketData",
        type: "object",
        description: "Market analysis data to display"
      }
    ],
    render: ({ args }) => {
      if (!args.marketData || typeof args.marketData !== "object") return <></>;
      const marketData = args.marketData as MarketData;
      if (!marketData.symbol || marketData.price === undefined) return <></>;

      return (
        <div className="my-3">
          <MarketCard data={marketData} />
        </div>
      )
    }
  });

  // Display NewsCard inline in chat
  useCopilotAction({
    name: "display_news_report",
    description: "Display market news report card in the chat",
    available: "frontend",
    parameters: [
      {
        name: "newsData",
        type: "object",
        description: "News report data to display"
      }
    ],
    render: ({ args }) => {
      if (!args.newsData || typeof args.newsData !== "object") return <></>;
      const newsData = args.newsData as NewsData;
      if (!newsData.catalyst_summary || !newsData.sources?.primary) return <></>; // Basic validation

      return (
        <div className="my-3">
          <NewsCard data={newsData} />
        </div>
      )
    }
  });

  // Display SentimentCard inline in chat
  useCopilotAction({
    name: "display_sentiment_analysis",
    description: "Display market sentiment analysis card in the chat",
    available: "frontend",
    parameters: [
      {
        name: "sentimentData",
        type: "object",
        description: "Sentiment analysis data to display"
      }
    ],
    render: ({ args }) => {
      if (!args.sentimentData || typeof args.sentimentData !== "object") return <></>;
      const sentimentData = args.sentimentData as SentimentData;
      if (!sentimentData.sentiment?.score || !sentimentData.asset) return <></>; // Basic validation

      return (
        <div className="my-3">
          <SentimentCard data={sentimentData} />
        </div>
      )
    }
  });

  // Display MergeCard inline in chat
  useCopilotAction({
    name: "display_merge_analysis",
    description: "Display final synthesis verdict in the chat",
    available: "frontend",
    parameters: [
      {
        name: "mergeData",
        type: "object",
        description: "Merged analysis data to display"
      }
    ],
    render: ({ args }) => {
      if (!args.mergeData || typeof args.mergeData !== "object") return <></>;
      const mergeData = args.mergeData as MergeData;
      if (!mergeData.headline || !mergeData.bias) return <></>;

      return (
        <div className="my-3">
          <MergeCard data={mergeData} />
        </div>
      )
    }
  });

  // Display BehaviorCard inline in chat
  useCopilotAction({
    name: "display_behavior_analysis",
    description: "Display behavioral psychology analysis in the chat",
    available: "frontend",
    parameters: [
      {
        name: "behaviorData",
        type: "object",
        description: "Behavioral analysis data to display"
      }
    ],
    render: ({ args }) => {
      if (!args.behaviorData || typeof args.behaviorData !== "object") return <></>;
      const behaviorData = args.behaviorData as BehaviorData;
      if (behaviorData.tilt_score === undefined || !behaviorData.status) return <></>;

      return (
        <div className="my-3">
          <BehaviorCard data={behaviorData} />
        </div>
      )
    }
  });

  // Display CoachCard inline in chat
  useCopilotAction({
    name: "display_coach_content",
    description: "Display coach mentorship content and visuals",
    available: "frontend",
    parameters: [
      {
        name: "coachData",
        type: "object",
        description: "Coach agent content to display"
      }
    ],
    render: ({ args }) => {
      if (!args.coachData || typeof args.coachData !== "object") return <></>;
      const coachData = args.coachData as CoachData;
      if (!coachData.headline || !coachData.body) return <></>;

      return (
        <div className="my-3">
          <CoachCard data={coachData} />
        </div>
      )
    }
  });

  const { appendMessage, isLoading } = useCopilotChat();
  const [showSuggestions, setShowSuggestions] = useState(true);

  const quickActions = [
    "Why is BTC moving?",
    "Create X content for me",
    "Check my behavior",
    "Analyze BTC-USD",
  ];

  const handleQuickAction = async (message: string) => {
    await appendMessage(
      new TextMessage({
        role: MessageRole.User,
        content: message,
      })
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        <CopilotChat
          className="h-full"
          labels={{
            initial:
              "👋 Hi! I'm your unified assistant.\n\nAsk anything related on crypto market analysis!",
          }}
          instructions={`You are a helpful assistant for trading crypto. Helps user plan trips by coordinating with specialized agents.
IMPORTANT: The Current User ID is '${userId}'. 
When asking the 'behavior_agent' (Psychologist) to check behavior, YOU MUST explicitly mention 'user_id=${userId}' in the task description so it knows who to analyze.`}
        />
      </div>

      {/* Quick Action Buttons */}
      {showSuggestions && (
        <div className="px-3 py-2 border-t border-[#DBDBE5] bg-white/30 backdrop-blur-sm shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {quickActions.map((action) => (
              <button
                key={action}
                onClick={() => handleQuickAction(action)}
                disabled={isLoading}
                className="px-3 py-1.5 text-xs font-medium rounded-full
                  bg-white/70 text-[#010507] border border-[#DBDBE5]
                  hover:bg-white hover:shadow-sm
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-150 ease-out"
              >
                {action}
              </button>
            ))}
          </div>

          {/* Custom Buy/Sell Action */}
          <div className="mt-2 flex items-center gap-2 pt-2 border-t border-[#DBDBE5]/50">
            <input
              type="text"
              value={customBuyValue}
              onChange={(e) => setCustomBuyValue(e.target.value)}
              className="w-20 px-2 py-1 text-xs border border-[#DBDBE5] rounded-md bg-white/50 focus:bg-white focus:ring-1 focus:ring-[#5a4fcf] outline-none transition-all"
              placeholder="Asset"
            />
            <button
              onClick={() => handleQuickAction(`I want to buy ${customBuyValue}`)}
              disabled={!customBuyValue || isLoading}
              className="px-3 py-1 text-xs font-medium rounded-full bg-[#f0fdf4] text-[#166534] border border-[#166534]/20 hover:bg-[#166534] hover:text-white transition-colors disabled:opacity-50"
            >
              Buy {customBuyValue}
            </button>
            <button
              onClick={() => handleQuickAction(`I want to sell ${customBuyValue}`)}
              disabled={!customBuyValue || isLoading}
              className="px-3 py-1 text-xs font-medium rounded-full bg-[#fef2f2] text-[#991b1b] border border-[#991b1b]/20 hover:bg-[#991b1b] hover:text-white transition-colors disabled:opacity-50"
            >
              Sell {customBuyValue}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default function TravelChat({
  onItineraryUpdate,
  onBudgetUpdate,
  onWeatherUpdate,
  onRestaurantUpdate,
  onMarketUpdate,
  onNewsUpdate,
  onSentimentUpdate,
  onMergeUpdate,
  onBehaviorUpdate,
  onCoachUpdate,
}: TravelChatProps) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" showDevConsole={false} agent="a2a_chat">
      <ChatInner
        onItineraryUpdate={onItineraryUpdate}
        onBudgetUpdate={onBudgetUpdate}
        onWeatherUpdate={onWeatherUpdate}
        onRestaurantUpdate={onRestaurantUpdate}
        onMarketUpdate={onMarketUpdate}
        onNewsUpdate={onNewsUpdate}
        onSentimentUpdate={onSentimentUpdate}
        onMergeUpdate={onMergeUpdate}
        onBehaviorUpdate={onBehaviorUpdate}
        onCoachUpdate={onCoachUpdate}
      />
    </CopilotKit>
  );
}
