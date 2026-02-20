import React from "react";

export interface CoachData {
    platform?: string;
    market_context?: string;
    headline: string;
    body: string;
    image_filename?: string;
    image_saved?: boolean;
}

export const CoachCard = ({ data }: { data: CoachData }) => {
    // Normalize image path: strip public/ prefix if present, ensure leading /
    const getImageSrc = (filename: string) => {
        if (filename.startsWith('http')) return filename;
        let cleaned = filename.replace(/^public[\\/\/]/, ''); // strip "public/" or "public\"
        return `/${cleaned}`;
    };

    return (
        <div className="bg-gradient-to-br from-purple-50 to-indigo-100 rounded-xl p-6 border-2 border-purple-300 mt-4 shadow-lg">
            <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">📊</span>
                <h3 className="font-bold text-purple-900 text-lg">Crypto Coach</h3>
                {data.platform && (
                    <span className="text-xs bg-purple-200 px-2 py-1 rounded">
                        {data.platform}
                    </span>
                )}
            </div>

            {data.market_context && (
                <div className="text-sm text-purple-700 mb-2 font-mono">
                    📈 {data.market_context}
                </div>
            )}

            <div className="bg-white rounded-lg p-4 mb-3">
                <h4 className="font-bold text-gray-900 mb-2">{data.headline}</h4>
                <p className="text-gray-700 whitespace-pre-wrap">{data.body}</p>
            </div>

            {data.image_filename && (
                <div className="bg-black/5 rounded-lg p-3">
                    <div className="text-sm text-gray-600 flex items-center gap-2 mb-2">
                        <span>🎨</span>
                        <span>Visual generated: <code className="text-purple-600">{data.image_filename}</code></span>
                    </div>
                    {/* Display the image — works with files in Next.js public/ folder */}
                    <img
                        src={getImageSrc(data.image_filename)}
                        alt="Coach Generated Visual"
                        className="w-full h-auto rounded-lg shadow-md mt-2 border border-gray-200"
                        onError={(e) => {
                            // Fallback if image fails to load
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                        }}
                    />
                </div>
            )}
        </div>
    );
};

