import React from "react";
import { SentimentData } from "./types";
import {
    ScaleIcon,
    ExclamationCircleIcon,
    ArrowTrendingUpIcon,
    ArrowTrendingDownIcon
} from "@heroicons/react/24/solid";

export const SentimentCard = ({ data }: { data: SentimentData }) => {

    const getScoreColor = (score: number) => {
        if (score >= 60) return "text-green-600";
        if (score <= 40) return "text-red-600";
        return "text-yellow-600";
    };

    const getBgColor = (score: number) => {
        if (score >= 60) return "bg-green-50/50 border-green-100";
        if (score <= 40) return "bg-red-50/50 border-red-100";
        return "bg-yellow-50/50 border-yellow-100";
    };

    return (
        <div className={`rounded-xl border-2 overflow-hidden shadow-sm transition-all hover:shadow-md ${getBgColor(data.sentiment.score)}`}>

            {/* Header Section */}
            <div className="p-4 border-b border-black/5 bg-white/40">
                <div className="flex justify-between items-center mb-4">
                    <span className="text-xs font-bold uppercase tracking-wider opacity-70 flex items-center gap-2">
                        {data.asset}
                        <span className="text-[10px] bg-white border border-black/5 px-1.5 py-0.5 rounded-md">
                            {data.timeframe}
                        </span>
                    </span>
                    <span className="text-[10px] text-gray-400">
                        {new Date(data.as_of).toLocaleDateString()}
                    </span>
                </div>

                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-baseline gap-2">
                            <h2 className={`text-4xl font-black ${getScoreColor(data.sentiment.score)}`}>
                                {data.sentiment.score}
                            </h2>
                            <div className="flex flex-col">
                                <span className={`text-lg font-bold leading-none ${getScoreColor(data.sentiment.score)}`}>
                                    {data.sentiment.label}
                                </span>
                                <span className={`text-xs font-medium flex items-center gap-1 mt-1 ${data.sentiment.change_24h >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {data.sentiment.change_24h > 0 ? <ArrowTrendingUpIcon className="w-3 h-3" /> : <ArrowTrendingDownIcon className="w-3 h-3" />}
                                    {Math.abs(data.sentiment.change_24h)} (24h)
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Image Embed */}
                    {data.image_url && (
                        <div className="w-32 h-32 flex items-center justify-center bg-white p-1 rounded-full shadow-sm border border-gray-100">
                            <img
                                src={data.image_url}
                                alt="F&G Index"
                                className="w-full h-full object-contain rounded-full opacity-90 hover:opacity-100 transition-opacity"
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Analysis Section */}
            <div className="p-4 space-y-4 bg-white/60">

                {data.analysis && (
                    <div className="space-y-3">
                        <div className="bg-white p-3 rounded-lg border border-black/5 shadow-sm">
                            <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Interpretation</h4>
                            <p className="text-sm text-gray-800 leading-relaxed">
                                {data.analysis.interpretation}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-2">
                            <div className="p-2 border-l-2 border-indigo-200 bg-indigo-50/30">
                                <span className="text-xs font-bold text-indigo-400 block mb-0.5">Crowd Psychology</span>
                                <p className="text-xs text-gray-600">{data.analysis.psychology}</p>
                            </div>
                            <div className="p-2 border-l-2 border-gray-300 bg-gray-50/50">
                                <span className="text-xs font-bold text-gray-400 block mb-0.5">Historical Context</span>
                                <p className="text-xs text-gray-600">{data.analysis.historical_context}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Market Context */}
                {data.market_context && data.market_context.length > 0 && (
                    <div>
                        <h4 className="text-[10px] font-bold text-gray-400 uppercase mb-2 flex items-center gap-1">
                            <ScaleIcon className="w-3 h-3" /> General Market Factors
                        </h4>
                        <ul className="space-y-1.5">
                            {data.market_context.map((ctx, idx) => (
                                <li key={idx} className="text-xs text-gray-600 pl-2 border-l-2 border-gray-200 flex items-start gap-2">
                                    <span>•</span> {ctx}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="bg-gray-50 border-t border-gray-100 p-3">
                <div className="flex items-start gap-2 mb-2">
                    <ExclamationCircleIcon className="w-4 h-4 text-blue-400 mt-0.5" />
                    <p className="text-xs text-gray-500 italic">
                        {data.next_update_hint}
                    </p>
                </div>

                {data.attribution && (
                    <div className="text-[10px] text-gray-400 text-right font-medium border-t border-gray-200 pt-1 mt-1">
                        {data.attribution}
                    </div>
                )}
            </div>

        </div>
    );
};
