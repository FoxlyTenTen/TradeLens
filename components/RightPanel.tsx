"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import { ItineraryCard, type ItineraryData } from "@/components/ItineraryCard";
import { BudgetBreakdown, type BudgetData } from "@/components/BudgetBreakdown";
import { WeatherCard, type WeatherData } from "@/components/WeatherCard";
import { MarketCard } from "@/components/MarketCard";
import { NewsCard } from "@/components/NewsCard";
import { SentimentCard } from "@/components/SentimentCard";
import { MergeCard } from "@/components/MergeCard";
import { BehaviorCard } from "@/components/BehaviorCard";
import { type RestaurantData, type MarketData, type NewsData, type SentimentData, type MergeData, type CoachData } from "@/components/types";
import { useSharedData } from "@/components/SharedDataContext";

const TravelChat = dynamic(() => import("@/components/travel-chat"), {
    ssr: false,
});

export function RightPanel() {
    const [itineraryData, setItineraryData] = useState<ItineraryData | null>(null);
    const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
    const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
    const [restaurantData, setRestaurantData] = useState<RestaurantData | null>(null);
    const [marketData, setMarketData] = useState<MarketData | null>(null);
    const [newsData, setNewsData] = useState<NewsData | null>(null);
    const [sentimentData, setSentimentData] = useState<SentimentData | null>(null);
    const [mergeData, setMergeData] = useState<MergeData | null>(null);
    const [behaviorData, setBehaviorData] = useState<any>(null);
    const { coachData, setCoachData } = useSharedData();
    const [activeTab, setActiveTab] = useState('market');

    return (
        <div className="flex-1 flex flex-col gap-2">
            {/* TOP: CopilotKit Chat */}
            <div className="h-[45%] min-h-[250px] border-2 border-white bg-white/50 backdrop-blur-md shadow-elevation-lg flex flex-col rounded-lg overflow-hidden">
                <div className="flex-1 overflow-hidden">
                    <TravelChat
                        onItineraryUpdate={setItineraryData}
                        onBudgetUpdate={setBudgetData}
                        onWeatherUpdate={setWeatherData}
                        onRestaurantUpdate={setRestaurantData}
                        onMarketUpdate={setMarketData}
                        onNewsUpdate={setNewsData}
                        onSentimentUpdate={setSentimentData}
                        onMergeUpdate={setMergeData}
                        onBehaviorUpdate={setBehaviorData}
                        onCoachUpdate={setCoachData}
                    />
                </div>
            </div>

            {/* BOTTOM: Tab Visualizations */}
            <div className="flex-1 border-2 border-white bg-white/50 backdrop-blur-md shadow-elevation-lg flex flex-col rounded-lg overflow-hidden">
                {/* Tab Header */}
                <div className="px-4 py-3 border-b border-[#DBDBE5] shrink-0">
                    <h2 className="text-lg font-semibold text-[#010507] leading-tight">Market Insights / Coach</h2>
                    <p className="text-xs text-[#57575B]">Toggle between outputs</p>
                </div>

                {/* Tab Navigation */}
                <div className="px-4 pt-3 shrink-0">
                    <div className="flex space-x-1 bg-white/40 backdrop-blur-md p-1 rounded-xl border border-white/50 shadow-sm">
                        {[
                            { id: 'market', label: 'Market Insights' },
                            { id: 'behavior', label: 'Personal Coach' },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                  flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ease-out
                  ${activeTab === tab.id
                                        ? 'bg-white text-[#010507] shadow-sm ring-1 ring-black/5'
                                        : 'text-[#57575B] hover:text-[#010507] hover:bg-white/50'
                                    }
                `}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tab Content (scrollable) */}
                <div className="flex-1 overflow-y-auto p-4">
                    {activeTab === 'market' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {!itineraryData && !budgetData && !weatherData && !marketData && !newsData && !sentimentData && !mergeData && (
                                <div className="flex items-center justify-center h-[200px] bg-white/60 backdrop-blur-md rounded-xl border-2 border-dashed border-[#DBDBE5]">
                                    <div className="text-center">
                                        <div className="text-4xl mb-2">📊</div>
                                        <h3 className="text-sm font-semibold text-[#010507] mb-1">System Ready for Analysis</h3>
                                        <p className="text-xs text-[#57575B] max-w-[240px] mx-auto">
                                            Initiate a request to activate the analysis swarm.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {mergeData && (
                                <div className="mb-3">
                                    <MergeCard data={mergeData} />
                                </div>
                            )}

                            {itineraryData && (
                                <div className="mb-3">
                                    <ItineraryCard data={itineraryData} restaurantData={restaurantData} />
                                </div>
                            )}

                            {(weatherData || budgetData) && (
                                <div className="grid grid-cols-1 gap-3">
                                    {weatherData && <WeatherCard data={weatherData} />}
                                    {budgetData && <BudgetBreakdown data={budgetData} />}
                                </div>
                            )}

                            {marketData && (
                                <div className="mb-3">
                                    <MarketCard data={marketData} />
                                </div>
                            )}

                            {newsData && (
                                <div className="mb-3">
                                    <NewsCard data={newsData} />
                                </div>
                            )}

                            {sentimentData && (
                                <div className="mb-3">
                                    <SentimentCard data={sentimentData} />
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'behavior' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {behaviorData ? (
                                <div className="mb-3">
                                    <BehaviorCard data={behaviorData} />
                                </div>
                            ) : (
                                <div className="h-[200px] flex items-center justify-center bg-white/40 backdrop-blur-sm rounded-2xl border border-white/60">
                                    <div className="text-center">
                                        <div className="h-12 w-12 bg-white/80 rounded-xl mx-auto mb-3 flex items-center justify-center shadow-sm">
                                            <span className="text-2xl">🧠</span>
                                        </div>
                                        <h3 className="text-sm font-semibold text-[#010507] mb-1">Personalized Behavior Analysis</h3>
                                        <p className="text-xs text-[#57575B]">Ask &quot;Check my behavior&quot; to generate an analysis.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
