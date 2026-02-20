"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// --- Configuration ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Define User Interface
interface User {
    id: string;
    name: string;
    role: string;
}

// Define Trade Data Interface matching the JSON
interface TradeTransaction {
    transaction_id: number;
    user_id: string;
    symbol: string;
    buy_time: number;
    sell_time: number;
    buy_price: string;
    sell_price: string;
    profit: string;
    status: "WON" | "LOST";
}

const USERS: User[] = [
    { id: "Good_Trader", name: "Good Trader", role: "Profit Maker" },
    { id: "Bad_Trader", name: "Bad Trader", role: "Risk Taker" },
];

export default function HistoryPage() {
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [data, setData] = useState<TradeTransaction[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load selection from local storage on mount
    useEffect(() => {
        const savedUserId = localStorage.getItem("trade_database_selected_user");
        if (savedUserId) {
            const user = USERS.find(u => u.id === savedUserId);
            if (user) setSelectedUser(user);
        }
    }, []);

    // Save selection to local storage AND notify other components
    useEffect(() => {
        if (selectedUser) {
            localStorage.setItem("trade_database_selected_user", selectedUser.id);
            window.dispatchEvent(new Event("profileChanged"));
        }
    }, [selectedUser]);

    // Fetch data when a user is selected
    useEffect(() => {
        if (!selectedUser) {
            setData(null);
            return;
        }

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const { data: result, error: fetchError } = await supabase
                    .from("trade_history")
                    .select("*")
                    .eq("user_id", selectedUser.id)
                    .order('transaction_id', { ascending: false }); // Newest first for history

                if (fetchError) throw fetchError;

                setData(result as TradeTransaction[]);
            } catch (err: any) {
                console.error("Error fetching data:", err);

                // Fallback Mock Data Logic
                if (err.message.includes("fetch") || err.code === "PGRST301" || err.message.includes("relation")) {
                    const isMissingTable = err.message.includes("relation");
                    setError(isMissingTable ? "Table 'trade_history' not found." : "Failed to connect to Supabase.");

                    const MOCK_DATA: TradeTransaction[] = [
                        { transaction_id: 9000100, user_id: "Good_Trader", symbol: "BTCUSD", buy_time: 1770925523, sell_time: 1770939923, buy_price: "1200.00", sell_price: "1450.00", profit: "250.00", status: "WON" },
                        { transaction_id: 9000101, user_id: "Good_Trader", symbol: "BTCUSD", buy_time: 1771011923, sell_time: 1771012523, buy_price: "1420.00", sell_price: "1410.00", profit: "-10.00", status: "LOST" },
                        { transaction_id: 9000102, user_id: "Good_Trader", symbol: "BTCUSD", buy_time: 1771091123, sell_time: 1771098223, buy_price: "1415.00", sell_price: "1500.00", profit: "85.00", status: "WON" },
                        { transaction_id: 9000200, user_id: "Bad_Trader", symbol: "BTCUSD", buy_time: 1771094723, sell_time: 1771094783, buy_price: "2030.00", sell_price: "2029.00", profit: "-10.00", status: "LOST" },
                        { transaction_id: 9000201, user_id: "Bad_Trader", symbol: "BTCUSD", buy_time: 1771095323, sell_time: 1771095423, buy_price: "1.0850", sell_price: "1.0840", profit: "-20.00", status: "LOST" },
                        { transaction_id: 9000202, user_id: "Bad_Trader", symbol: "BTCUSD", buy_time: 1771095923, sell_time: 1771096023, buy_price: "1200.00", sell_price: "1180.00", profit: "-40.00", status: "LOST" },
                        { transaction_id: 9000203, user_id: "Bad_Trader", symbol: "BTCUSD", buy_time: 1771096523, sell_time: 1771096623, buy_price: "96000.00", sell_price: "95800.00", profit: "-80.00", status: "LOST" },
                        { transaction_id: 9000204, user_id: "Bad_Trader", symbol: "BTCUSD", buy_time: 1771097723, sell_time: 1771098023, buy_price: "95800.00", sell_price: "96200.00", profit: "160.00", status: "WON" }
                    ];

                    setData(MOCK_DATA.filter(t => t.user_id === selectedUser.id).reverse()); // Reverse mock to match DESC order
                } else {
                    setError(err.message);
                }
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        const channel = supabase
            .channel('realtime_trades_history')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_history', filter: `user_id=eq.${selectedUser.id}` }, (payload) => {
                fetchData();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };

    }, [selectedUser]);

    const formatDate = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleString();
    };

    return (
        <div className="p-8 h-full bg-background text-foreground animate-in fade-in duration-500 overflow-hidden flex flex-col">
            <header className="mb-6 flex-shrink-0 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Trading History</h1>
                    <p className="text-muted-foreground mt-2">
                        Complete historical record of all executed trades.
                    </p>
                </div>

            </header>

            {!selectedUser ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border mx-auto w-full max-w-2xl h-64">
                    <div className="text-center">
                        <p>No active profile found.</p>
                        <p className="text-sm">Please select a profile in the Profile page.</p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-auto bg-card border border-border rounded-xl shadow-sm">
                    {loading ? (
                        <div className="p-12 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
                    ) : error ? (
                        <div className="p-8 text-center text-destructive">{error}</div>
                    ) : data && data.length > 0 ? (
                        <TradesTable data={data} formatDate={formatDate} />
                    ) : (
                        <div className="p-12 text-center text-muted-foreground">No history available.</div>
                    )}
                </div>
            )}
        </div>
    );
}

function TradesTable({ data, formatDate }: { data: TradeTransaction[], formatDate: (ts: number) => string }) {
    return (
        <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-muted/50 text-muted-foreground sticky top-0 z-10">
                <tr>
                    <th className="px-6 py-4 font-medium">Transaction</th>
                    <th className="px-6 py-4 font-medium">Symbol</th>
                    <th className="px-6 py-4 font-medium">Date/Time</th>
                    <th className="px-6 py-4 font-medium text-right">Entry</th>
                    <th className="px-6 py-4 font-medium text-right">Exit</th>
                    <th className="px-6 py-4 font-medium text-right">PnL</th>
                    <th className="px-6 py-4 font-medium text-center">Status</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-border">
                {data.map((trade) => (
                    <tr key={trade.transaction_id} className="bg-background hover:bg-muted/50 transition-colors">
                        <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                            #{trade.transaction_id}
                        </td>
                        <td className="px-6 py-4 font-bold">
                            {trade.symbol}
                        </td>
                        <td className="px-6 py-4">
                            <div className="flex flex-col gap-1 text-xs">
                                <span className="">{formatDate(trade.buy_time)}</span>
                                <span className="text-muted-foreground opacity-70">to {formatDate(trade.sell_time)}</span>
                            </div>
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-green-600/70 dark:text-green-400/70">
                            {trade.buy_price}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-red-600/70 dark:text-red-400/70">
                            {trade.sell_price}
                        </td>
                        <td className={`px-6 py-4 text-right font-bold ${parseFloat(trade.profit) >= 0 ? 'text-green-500' : 'text-red-500'
                            }`}>
                            {parseFloat(trade.profit) >= 0 ? '+' : ''}{trade.profit}
                        </td>
                        <td className="px-6 py-4 text-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${trade.status === 'WON'
                                ? 'bg-green-500/10 text-green-500 border-green-500/20'
                                : 'bg-red-500/10 text-red-500 border-red-500/20'
                                }`}>
                                {trade.status}
                            </span>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
