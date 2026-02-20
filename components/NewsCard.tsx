
import React from "react";
import { NewsData } from "./types";
import {
    NewspaperIcon,
    CheckBadgeIcon,
    ExclamationTriangleIcon,
    EyeIcon,
    ChatBubbleBottomCenterTextIcon,
    ArrowTopRightOnSquareIcon
} from "@heroicons/react/24/solid";

interface NewsCardProps {
    data: NewsData;
}

export const NewsCard: React.FC<NewsCardProps> = ({ data }) => {
    // Helper for reliability color
    const getRelColor = (rating: string) => {
        switch (rating) {
            case "High": return "bg-green-100 text-green-800 border-green-200";
            case "Medium": return "bg-yellow-100 text-yellow-800 border-yellow-200";
            case "Low": return "bg-red-100 text-red-800 border-red-200";
            default: return "bg-gray-100 text-gray-800 border-gray-200";
        }
    };

    return (
        <div className="bg-white rounded-xl border-2 border-orange-100 shadow-sm overflow-hidden flex flex-col gap-4 p-5 transition-all hover:shadow-md">
            {/* Header / Catalyst */}
            <div>
                <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                        <span className="bg-orange-100 text-orange-800 text-xs font-bold px-2 py-0.5 rounded-full border border-orange-200">
                            {data.asset} NEWS
                        </span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${getRelColor(data.reliability.rating)}`}>
                            {data.reliability.rating.toUpperCase()} RELIABILITY
                        </span>
                    </div>
                </div>
                <h3 className="font-bold text-gray-900 text-lg leading-tight mb-2">
                    {data.catalyst_summary}
                </h3>
                <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">
                    <span className="font-semibold text-gray-700 block mb-1">What Happened:</span>
                    {data.what_happened}
                </div>
            </div>

            {/* Why It Matters & Causality */}
            <div className="grid grid-cols-1 gap-3">
                <div className="border-l-4 border-blue-400 pl-3 py-1">
                    <h4 className="text-xs font-bold text-blue-600 uppercase mb-1">Why It Matters</h4>
                    <p className="text-sm text-gray-700">{data.why_it_matters}</p>
                </div>

                <div className="flex gap-2 items-start bg-yellow-50 p-3 rounded-lg border border-yellow-100">
                    <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                    <div>
                        <h4 className="text-xs font-bold text-yellow-700 uppercase mb-0.5">Causality Note</h4>
                        <p className="text-xs text-yellow-800 italic">{data.causality_note}</p>
                    </div>
                </div>
            </div>

            {/* Primary Source */}
            <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
                <div className="flex justify-between items-center mb-2">
                    <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1">
                        <NewspaperIcon className="w-4 h-4" /> Primary Source
                    </h4>
                    <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {data.sources.primary.type}
                    </span>
                </div>

                {data.sources.primary.source_name && (
                    <div className="text-xs font-bold text-gray-700 mb-0.5">
                        {data.sources.primary.source_name}
                    </div>
                )}

                <a
                    href={data.sources.primary.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 font-medium hover:underline text-sm flex items-start gap-1 group block"
                >
                    {data.sources.primary.title}
                    <ArrowTopRightOnSquareIcon className="w-3 h-3 mt-1 opacity-50 group-hover:opacity-100 shrink-0" />
                </a>

                <div className="flex gap-3 mt-2 text-xs text-gray-500 items-center">
                    {data.sources.primary.confirmations !== undefined && (
                        <span className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded text-gray-600 border border-gray-100">
                            <CheckBadgeIcon className="w-3 h-3 text-green-500" /> {data.sources.primary.confirmations} Confirmations
                        </span>
                    )}
                    {data.sources.primary.published_at && (
                        <span>
                            {new Date(data.sources.primary.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                </div>
            </div>

            {/* Key Quote */}
            {data.key_quote && (
                <div className="relative pl-8 italic text-gray-600 text-sm">
                    <ChatBubbleBottomCenterTextIcon className="w-6 h-6 text-gray-300 absolute left-0 top-0" />
                    <p>"{data.key_quote.quote}"</p>
                    <p className="text-xs text-gray-400 mt-1 not-italic">— {data.key_quote.context}</p>
                </div>
            )}

            {/* What to Watch */}
            {data.what_to_watch && data.what_to_watch.length > 0 && (
                <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100">
                    <h4 className="text-xs font-bold text-blue-600 uppercase mb-2 flex items-center gap-1">
                        <EyeIcon className="w-4 h-4" /> What to Watch
                    </h4>
                    <ul className="space-y-2">
                        {data.what_to_watch.map((item, idx) => (
                            <li key={idx} className="text-sm text-gray-700 flex gap-2 items-start">
                                <span className="font-bold text-blue-500">•</span>
                                <div>
                                    <span className="font-semibold">{item.signal}:</span> {item.why}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Supporting Sources (Collapsed/Small) */}
            {data.sources.supporting && data.sources.supporting.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Supporting Coverage</h4>
                    <div className="space-y-1">
                        {data.sources.supporting.slice(0, 3).map((item, i) => (
                            <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="block text-xs text-blue-500 hover:text-blue-700 truncate">
                                + {item.title}
                            </a>
                        ))}
                        {data.sources.supporting.length > 3 && (
                            <span className="text-xs text-gray-400 block px-1">
                                + {data.sources.supporting.length - 3} more sources...
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
