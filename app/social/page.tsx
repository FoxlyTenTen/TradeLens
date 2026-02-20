"use client";

import { CoachCard } from "@/components/CoachCard";
import { useSharedData } from "@/components/SharedDataContext";

export default function SocialPage() {
    const { coachData } = useSharedData();

    return (
        <div className="flex-1 overflow-y-auto bg-white/30 backdrop-blur-sm rounded-lg">
            <div className="p-6">
                {/* Page Header */}
                <div className="mb-6">
                    <h1 className="text-2xl font-semibold text-[#010507] mb-1">Social Media Generator</h1>
                    <p className="text-sm text-[#57575B]">
                        Generate AI-powered social media content, trading posts, and market insight visuals.
                    </p>
                </div>

                {/* Show CoachCard when data is available */}
                {coachData ? (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <CoachCard data={coachData} />
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-[400px] bg-white/60 backdrop-blur-md rounded-xl border-2 border-dashed border-[#DBDBE5]">
                        <div className="text-center">
                            <div className="text-6xl mb-4 p-4 bg-white/50 rounded-2xl shadow-sm inline-block">🎨</div>
                            <h3 className="text-xl font-semibold text-[#010507] mb-2">
                                Content Creation Ready
                            </h3>
                            <p className="text-[#57575B] max-w-md mx-auto mb-4">
                                Use the chat on the right to generate social media content. Try asking:
                            </p>
                            <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
                                {[
                                    "Create a Telegram post about Bitcoin",
                                    "Generate a crash warning visual for X",
                                    "Write an X post on ETH market analysis",
                                    "Make a Telegram channel update about crypto trends",
                                ].map((suggestion) => (
                                    <span
                                        key={suggestion}
                                        className="px-3 py-1.5 text-xs font-medium rounded-full bg-white/70 text-[#010507] border border-[#DBDBE5]"
                                    >
                                        {suggestion}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
