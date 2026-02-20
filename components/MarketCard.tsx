import React from "react";
import { MarketData, SpeedometerData } from "./types";
import {
    TrendingUp, TrendingDown, Activity, Droplets, Zap, Gauge,
    CircleDashed, ShieldAlert, TriangleAlert, CircleCheck,
    DollarSign, ArrowUpRight, ArrowDownRight
} from "lucide-react";

// Icon mapping helper
const IconMap: { [key: string]: React.ElementType } = {
    TrendingUp, TrendingDown, Activity, Droplets, Zap, Gauge,
    CircleDashed, ShieldAlert, TriangleAlert, CircleCheck
};

const DynamicIcon = ({ name, className }: { name: string; className?: string }) => {
    const Icon = IconMap[name] || CircleDashed;
    return <Icon className={className} />;
};

// Speedometer Component
const Speedometer = ({ data }: { data: SpeedometerData }) => {
    const { min, max, value, zones, needle_color } = data;
    const radius = 90;
    const center = 100;
    const strokeWidth = 12;

    // Helper to calculate coordinates for arc
    const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
        const angleInRadians = (angleInDegrees - 180) * Math.PI / 180.0;
        return {
            x: centerX + (radius * Math.cos(angleInRadians)),
            y: centerY + (radius * Math.sin(angleInRadians))
        };
    };

    const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
        const start = polarToCartesian(x, y, radius, endAngle);
        const end = polarToCartesian(x, y, radius, startAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
        return [
            "M", start.x, start.y,
            "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
        ].join(" ");
    };

    // Map 0-100 to 0-180 degrees
    const valueToAngle = (v: number) => (v / max) * 180;

    return (
        <div className="relative w-full h-32 flex flex-col items-center justify-end overflow-visible">
            <svg viewBox="0 0 200 110" className="w-full h-full">
                {/* Zones */}
                {zones.map((zone, idx) => {
                    const start = valueToAngle(zone.from);
                    const end = valueToAngle(zone.to);
                    return (
                        <path
                            key={idx}
                            d={describeArc(center, 100, radius, start, end)}
                            fill="none"
                            stroke={zone.color}
                            strokeWidth={strokeWidth}
                            strokeLinecap={idx === 0 ? "round" : idx === zones.length - 1 ? "round" : "butt"}
                            className="opacity-80"
                        />
                    );
                })}

                {/* Arrow Needle */}
                <g transform={`rotate(${valueToAngle(value)}, ${center}, 100)`}>
                    <polygon points="100,96 15,100 100,104" fill={needle_color} />
                    <circle cx="100" cy="100" r="4" fill={needle_color} />
                </g>

                {/* Min/Max Labels */}
                <text x="10" y="105" fontSize="10" fill="#9ca3af" textAnchor="start">0</text>
                <text x="190" y="105" fontSize="10" fill="#9ca3af" textAnchor="end">100</text>
            </svg>

            {/* Center Label */}
            <div className="absolute bottom-0 flex flex-col items-center translate-y-2">
                <span className="text-2xl font-black" style={{ color: data.label_color }}>
                    {data.label}
                </span>
                <span className="text-[10px] text-gray-400 font-medium bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
                    {data.scale_note.split(' ')[0]} {value}
                </span>
            </div>

            <div className="absolute top-2 right-2">
                <DynamicIcon name={data.icon} className="w-5 h-5 text-gray-300" />
            </div>
        </div>
    );
};

interface MarketCardProps {
    data: MarketData;
}

export const MarketCard: React.FC<MarketCardProps> = ({ data }) => {
    const isPositive = data.change_24h >= 0;

    return (
        <div className="rounded-xl border border-gray-200 bg-white/60 backdrop-blur-sm p-4 shadow-sm transition-all hover:shadow-md space-y-4">

            {/* 1. Header: Symbol & Price */}
            <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
                        <DollarSign className="w-5 h-5 text-gray-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-800 leading-tight">{data.symbol}</h2>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-gray-500">24h Change</span>
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-black text-gray-900 tracking-tight">
                        ${data.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <span className={`text-sm font-bold flex items-center justify-end ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {isPositive ? <ArrowUpRight className="w-4 h-4 mr-1" /> : <ArrowDownRight className="w-4 h-4 mr-1" />}
                        {Math.abs(data.change_24h)}%
                    </span>
                </div>
            </div>

            {/* 2. Speedometer Visualization */}
            <div className="py-2">
                {data.speedometer ? (
                    <Speedometer data={data.speedometer} />
                ) : (
                    <div className="text-center text-gray-400 py-8 text-sm">Loading Gauge...</div>
                )}
            </div>

            {/* 3. Deterministic Components Grid */}
            <div className="grid grid-cols-2 gap-3">
                {/* Liquidity */}
                <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden group hover:border-blue-100 transition-colors">
                    <div className="text-[10px] uppercase font-bold text-gray-400 mb-1 flex items-center gap-1">
                        <Droplets className="w-3 h-3" /> Liquidity
                    </div>
                    <div className="text-sm font-bold text-gray-700 group-hover:text-blue-600 transition-colors">
                        {data.components.liquidity.label}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 font-mono">
                        Ratio: {data.components.liquidity.value}
                    </div>
                </div>

                {/* Trend */}
                <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden group hover:border-purple-100 transition-colors">
                    <div className="text-[10px] uppercase font-bold text-gray-400 mb-1 flex items-center gap-1">
                        <Activity className="w-3 h-3" /> Trend
                    </div>
                    <div className="text-sm font-bold text-gray-700 group-hover:text-purple-600 transition-colors">
                        {data.components.trend.label}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate font-mono">
                        {data.components.trend.value}
                    </div>
                </div>

                {/* Momentum */}
                <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden group hover:border-orange-100 transition-colors">
                    <div className="text-[10px] uppercase font-bold text-gray-400 mb-1 flex items-center gap-1">
                        <Zap className="w-3 h-3" /> Momentum
                    </div>
                    <div className="text-sm font-bold text-gray-700 group-hover:text-orange-600 transition-colors">
                        {data.components.momentum.label}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 font-mono">
                        RSI: {data.components.momentum.value}
                    </div>
                </div>

                {/* Volatility */}
                <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden group hover:border-pink-100 transition-colors">
                    <div className="text-[10px] uppercase font-bold text-gray-400 mb-1 flex items-center gap-1">
                        <Gauge className="w-3 h-3" /> Volatility
                    </div>
                    <div className="text-sm font-bold text-gray-700 group-hover:text-pink-600 transition-colors">
                        {data.components.volatility.label}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate font-mono">
                        {data.components.volatility.value}
                    </div>
                </div>
            </div>

            {/* 4. Primary Driver & Explanation */}
            <div className="bg-gray-50/80 p-4 rounded-xl border border-gray-200/60">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200/60">
                    <span className="text-[10px] font-bold uppercase text-gray-500">Primary Driver</span>
                    <span className="flex items-center gap-1.5 px-2 py-1 bg-white rounded border border-gray-200 text-xs font-bold text-gray-800 shadow-sm">
                        <DynamicIcon name={data.primary_driver_icon} className="w-3 h-3 text-indigo-500" />
                        {data.primary_driver}
                    </span>
                </div>

                <h3 className="text-xs font-bold text-indigo-400 uppercase mb-1 flex items-center gap-1">
                    Wait & Watch Logic
                </h3>
                <p className="text-sm text-gray-700 leading-relaxed italic">
                    "{data.explanation}"
                </p>
            </div>

        </div>
    );
};
