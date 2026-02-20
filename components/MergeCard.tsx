import React from "react";
import { MergeData } from "./types";
import { ShieldCheckIcon, ExclamationTriangleIcon, BoltIcon, ChartBarIcon, NewspaperIcon, UserGroupIcon } from "@heroicons/react/24/solid";

export const MergeCard = ({ data }: { data: MergeData }) => {
    const getBadgeColor = (color: string) => {
        switch (color) {
            case "green": return "bg-green-100 text-green-800 border-green-200";
            case "red": return "bg-red-100 text-red-800 border-red-200";
            case "yellow": return "bg-yellow-100 text-yellow-800 border-yellow-200";
            default: return "bg-gray-100 text-gray-800 border-gray-200";
        }
    };

    const getBorderColor = (color: string) => {
        switch (color) {
            case "green": return "border-green-500";
            case "red": return "border-red-500";
            case "yellow": return "border-yellow-500";
            default: return "border-gray-500";
        }
    };

    return (
        <div className={`bg-white rounded-xl overflow-hidden shadow-lg border-l-4 ${getBorderColor(data.signal_color)} mt-4`}>
            {/* Header */}
            <div className="p-5 border-b border-gray-100 flex justify-between items-start">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest">{data.asset}</h2>
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{data.timeframe}</span>
                    </div>
                    <div className="text-3xl font-black text-gray-800">{data.bias}</div>
                </div>
                <div className={`px-3 py-1 rounded-full text-sm font-bold border ${getBadgeColor(data.signal_color)}`}>
                    {data.confidence} Confidence
                </div>
            </div>

            {/* Headline */}
            <div className="p-5 bg-gray-50">
                <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                    <BoltIcon className="w-4 h-4 text-blue-500" /> Summary
                </h3>
                <p className="text-gray-800 leading-relaxed font-medium text-lg">
                    {data.headline}
                </p>
            </div>

            {/* Why - 3 Components */}
            <div className="p-5 border-t border-gray-100">
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">Why? (The 3 Pillars)</h3>
                <div className="space-y-3">
                    {data.why.map((reason, i) => {
                        let icon = <BoltIcon className="w-4 h-4 text-gray-400" />;
                        if (reason.toLowerCase().includes("technical")) icon = <ChartBarIcon className="w-4 h-4 text-blue-400" />;
                        if (reason.toLowerCase().includes("news")) icon = <NewspaperIcon className="w-4 h-4 text-purple-400" />;
                        if (reason.toLowerCase().includes("sentiment")) icon = <UserGroupIcon className="w-4 h-4 text-orange-400" />;

                        return (
                            <div key={i} className="flex items-start gap-3 text-sm text-gray-700">
                                <div className="mt-0.5 shrink-0">{icon}</div>
                                <div>{reason}</div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* What to Watch */}
            <div className="p-5 bg-blue-50/30 border-t border-blue-50">
                <h3 className="text-xs font-bold text-blue-600 uppercase mb-3 flex items-center gap-1">
                    What to Watch
                </h3>
                <ul className="space-y-2">
                    {data.what_to_watch.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                            <span className="text-blue-400 mt-1">•</span>
                            {item}
                        </li>
                    ))}
                </ul>
            </div>

            {/* Risk Flag */}
            <div className="p-4 bg-orange-50 border-t border-orange-100 text-orange-900 text-sm font-medium flex items-start gap-2">
                <ExclamationTriangleIcon className="w-5 h-5 text-orange-600 shrink-0" />
                {data.risk_flag}
            </div>
        </div>
    );
};
