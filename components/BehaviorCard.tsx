import React from "react";
import { BehaviorData } from "./types";
import { AlertCircle, UserCheck, ShieldAlert, Activity, TrendingDown, Skull } from "lucide-react";

interface BehaviorCardProps {
    data: BehaviorData;
}

export const BehaviorCard: React.FC<BehaviorCardProps> = ({ data }) => {
    // Destructure new fields based on updated BehaviorData interface
    const {
        tilt_score,
        status,
        coach_message,
        block_trade,
        current_state,
        patterns,
        current_asset_context
    } = data;

    const getStatusColor = (status: string) => {
        switch (status) {
            case "CRITICAL":
                return "bg-red-500 text-white border-red-600";
            case "WARNING":
                return "bg-amber-500 text-white border-amber-600";
            case "NORMAL":
                return "bg-emerald-500 text-white border-emerald-600";
            default:
                return "bg-slate-500 text-white border-slate-600";
        }
    };

    const statusBadge = getStatusColor(status);

    return (
        <div className="bg-card/95 backdrop-blur-sm rounded-xl border border-border shadow-sm w-full overflow-hidden flex flex-col h-full animate-in fade-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="p-4 border-b border-border bg-muted/30 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${status === 'NORMAL' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                        <Activity className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-bold text-foreground leading-tight">Psycho-Analysis</h3>
                        <p className="text-xs text-muted-foreground">Real-time Mindset Check</p>
                    </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold shadow-sm ${statusBadge} flex items-center gap-1.5`}>
                    {status === 'CRITICAL' && <ShieldAlert className="w-3 h-3" />}
                    {status}
                </div>
            </div>

            <div className="p-5 flex-1 flex flex-col gap-5">
                {/* Score & Main Metric */}
                <div className="flex items-center justify-between">
                    <div className="relative w-24 h-24 flex items-center justify-center">
                        <svg className="w-full h-full transform -rotate-90">
                            <circle
                                cx="50%" cy="50%" r="40"
                                className="stroke-muted fill-none"
                                strokeWidth="8"
                            />
                            <circle
                                cx="50%" cy="50%" r="40"
                                className={`fill-none transition-all duration-1000 ease-out ${tilt_score > 70 ? 'stroke-red-500' :
                                    tilt_score > 40 ? 'stroke-amber-500' : 'stroke-emerald-500'
                                    }`}
                                strokeWidth="8"
                                strokeDasharray="251.2"
                                strokeDashoffset={251.2 - (251.2 * tilt_score) / 100}
                                strokeLinecap="round"
                            />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-2xl font-bold tabular-nums">{tilt_score}</span>
                            <span className="text-[10px] text-muted-foreground uppercase font-medium">Tilt Score</span>
                        </div>
                    </div>

                    <div className="flex-1 pl-6">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <span className="text-xs text-muted-foreground block">Streak</span>
                                <span className={`font-mono text-sm font-medium block truncate ${current_state.current_loss_streak > 2 ? 'text-red-500' : 'text-foreground'}`}>
                                    {current_state.current_loss_streak > 0 ? `${current_state.current_loss_streak} Loss` : "Winning"}
                                </span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-xs text-muted-foreground block">Last Res</span>
                                <span className={`font-mono text-sm font-bold block ${current_state.last_result === 'LOSS' ? 'text-red-500' :
                                        current_state.last_result === 'WIN' ? 'text-emerald-500' :
                                            'text-muted-foreground'
                                    }`}>
                                    {current_state.last_result}
                                </span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-xs text-muted-foreground block">Revenge Risk</span>
                                <span className={`font-mono text-sm font-medium block ${current_state.is_revenge_trading_risk ? 'text-red-500 font-bold' : 'text-muted-foreground'}`}>
                                    {current_state.is_revenge_trading_risk ? "HIGH" : "Low"}
                                </span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-xs text-muted-foreground block">Action</span>
                                <span className={`font-bold text-xs px-2 py-0.5 rounded w-fit block ${block_trade ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                                    {block_trade ? "BLOCKED" : "ALLOWED"}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* New Toxic Asset Warning Section */}
                {patterns.is_viewing_toxic_asset && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-3">
                        <Skull className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                        <div>
                            <h5 className="font-bold text-xs text-red-800 dark:text-red-300 uppercase">Toxic Asset Detected</h5>
                            <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                                You have a {patterns.toxic_asset_win_rate} win rate on {current_asset_context}. Proceed with caution.
                            </p>
                        </div>
                    </div>
                )}

                {/* Intervention Message */}
                <div className={`p-4 rounded-lg text-sm border-l-4 shadow-sm flex gap-3 ${status === 'CRITICAL'
                    ? 'bg-red-50 text-red-900 border-red-500 dark:bg-red-950/20 dark:text-red-200'
                    : status === 'WARNING'
                        ? 'bg-amber-50 text-amber-900 border-amber-500 dark:bg-amber-950/20 dark:text-amber-200'
                        : 'bg-emerald-50 text-emerald-900 border-emerald-500 dark:bg-emerald-950/20 dark:text-emerald-200'
                    }`}>
                    <UserCheck className="w-5 h-5 flex-shrink-0 mt-0.5 opacity-80" />
                    <div>
                        <h4 className="font-bold text-xs uppercase mb-1 opacity-70 tracking-wide">Accountability Partner</h4>
                        <p className="leading-relaxed font-medium">"{coach_message}"</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
