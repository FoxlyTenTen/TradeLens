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
    id: string; // Changed from number to string to match JSON 'user_id'
    name: string;
    role: string;
}

// Define User Constraints Interface (The Iron Rules)
interface UserConstraints {
    user_id: string;
    max_daily_loss: number;
    max_daily_trades: number;
    risk_per_trade_pct: number;
    max_consecutive_losses: number;
    last_updated?: string;
}

// Updated Users
const USERS: User[] = [
    { id: "Good_Trader", name: "Good Trader", role: "Profit Maker" },
    { id: "Bad_Trader", name: "Bad Trader", role: "Risk Taker" },
];

export default function ProfilePage() {
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [constraints, setConstraints] = useState<UserConstraints | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Load selection from local storage on mount
    useEffect(() => {
        const savedUserId = localStorage.getItem("trade_database_selected_user");
        if (savedUserId) {
            const user = USERS.find(u => u.id === savedUserId);
            if (user) setSelectedUser(user);
        } else {
            // Default to Good Trader if nothing saved
            setSelectedUser(USERS[0]);
        }
    }, []);

    // Save selection to local storage AND notify other components in the same tab
    useEffect(() => {
        if (selectedUser) {
            localStorage.setItem("trade_database_selected_user", selectedUser.id);
            // Dispatch custom event so travel-chat.tsx picks up the change (same-tab)
            window.dispatchEvent(new Event("profileChanged"));
        }
    }, [selectedUser]);

    // Fetch constraints when user changes
    useEffect(() => {
        if (!selectedUser) {
            setConstraints(null);
            return;
        }

        const fetchConstraints = async () => {
            setLoading(true);
            setMessage(null);
            try {
                // Try to find existing constraints
                const { data, error } = await supabase
                    .from('user_constraints')
                    .select('*')
                    .eq('user_id', selectedUser.id)
                    .single();

                if (error && error.code !== 'PGRST116') { // PGRST116 is "Row not found" - ignore it
                    throw error;
                }

                if (data) {
                    setConstraints(data);
                } else {
                    // Start with defaults if no record exists
                    setConstraints({
                        user_id: selectedUser.id,
                        max_daily_loss: 50.00,
                        max_daily_trades: 10,
                        risk_per_trade_pct: 2.0,
                        max_consecutive_losses: 3
                    });
                }
            } catch (err: any) {
                console.error("Error loading profile:", err);
                setMessage({ type: 'error', text: "Could not load profile. Check Supabase setup." });
            } finally {
                setLoading(false);
            }
        };

        fetchConstraints();

        // Subscribe to changes in constraints (e.g. if updated elsewhere)
        const subscription = supabase
            .channel('profile_updates')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_constraints', filter: `user_id=eq.${selectedUser.id}` }, (payload) => {
                setConstraints(payload.new as UserConstraints);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(subscription);
        };

    }, [selectedUser]);


    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUser || !constraints) return;

        setSaving(true);
        setMessage(null);

        try {
            // Upsert (Insert or Update) the constraints
            const { error } = await supabase
                .from('user_constraints')
                .upsert({
                    ...constraints,
                    user_id: selectedUser.id,
                    last_updated: new Date().toISOString()
                });

            if (error) throw error;

            setMessage({ type: 'success', text: "Profile updated successfully! The AI will now enforce these rules." });

            // Clear success message after 3 seconds
            setTimeout(() => setMessage(null), 3000);

        } catch (err: any) {
            console.error("Error saving profile:", err);
            setMessage({ type: 'error', text: `Failed to save: ${err.message}` });
        } finally {
            setSaving(false);
        }
    };

    const handleInputChange = (field: keyof UserConstraints, value: string) => {
        if (!constraints) return;
        setConstraints({
            ...constraints,
            [field]: parseFloat(value) || 0 // Simple parsing, could be improved
        });
    };

    return (
        <div className="p-8 h-full bg-background text-foreground animate-in fade-in duration-500 overflow-y-auto custom-scrollbar">
            <header className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight mb-2">Trading Constitution</h1>
                <p className="text-muted-foreground text-lg">
                    Define your "Iron Rules". The AI Behavior Agent will actively monitor your trading and intervene if you break these promises.
                </p>
            </header>

            {/* Profile Selection Bar */}
            <div className="flex items-center space-x-4 mb-8 bg-card p-4 rounded-xl border border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">Active Profile:</span>
                <div className="flex flex-wrap gap-2">
                    {USERS.map((user) => (
                        <button
                            key={user.id}
                            onClick={() => setSelectedUser(user)}
                            className={`px-6 py-2 rounded-full font-medium transition-all duration-200 border ${selectedUser?.id === user.id
                                ? "bg-primary text-primary-foreground border-primary shadow-md ring-2 ring-primary/20"
                                : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                                }`}
                        >
                            {user.name}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center p-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                </div>
            ) : !selectedUser || !constraints ? (
                <div className="text-center p-12 text-muted-foreground">Select a profile to edit settings.</div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                    {/* The Constitution Form */}
                    <div className="lg:col-span-2">
                        <form onSubmit={handleSave} className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                            <div className="p-6 border-b border-border">
                                <h2 className="text-xl font-semibold flex items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                    </svg>
                                    Risk Management Rules
                                </h2>
                                <p className="text-sm text-muted-foreground mt-1">
                                    These settings act as a pre-commitment device.
                                </p>
                            </div>

                            <div className="p-6 space-y-6">

                                {/* Max Daily Loss */}
                                <div className="space-y-2">
                                    <label htmlFor="max_loss" className="text-sm font-medium flex justify-between">
                                        <span>Max Daily Loss ($)</span>
                                        <span className="text-muted-foreground text-xs">HARD STOP</span>
                                    </label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <span className="text-muted-foreground">$</span>
                                        </div>
                                        <input
                                            type="number"
                                            id="max_loss"
                                            value={constraints.max_daily_loss}
                                            onChange={(e) => handleInputChange('max_daily_loss', e.target.value)}
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-7 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                            placeholder="50.00"
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        "Stop me if I lose more than <strong>${constraints.max_daily_loss}</strong> today."
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Max Trades */}
                                    <div className="space-y-2">
                                        <label htmlFor="max_trades" className="text-sm font-medium">Max Trades Per Day</label>
                                        <input
                                            type="number"
                                            id="max_trades"
                                            value={constraints.max_daily_trades}
                                            onChange={(e) => handleInputChange('max_daily_trades', e.target.value)}
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Prevents overtrading.
                                        </p>
                                    </div>

                                    {/* Risk Per Trade */}
                                    <div className="space-y-2">
                                        <label htmlFor="risk_per_trade" className="text-sm font-medium">Max Risk Per Trade (%)</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                id="risk_per_trade"
                                                value={constraints.risk_per_trade_pct}
                                                onChange={(e) => handleInputChange('risk_per_trade_pct', e.target.value)}
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-7 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                            />
                                            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                                <span className="text-muted-foreground">%</span>
                                            </div>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Capital protection.
                                        </p>
                                    </div>
                                </div>

                                {/* Cool-down Trigger */}
                                <div className="space-y-2">
                                    <label htmlFor="consecutive_loss" className="text-sm font-medium">Cool-down Trigger (Loss Streak)</label>
                                    <input
                                        type="number"
                                        id="consecutive_loss"
                                        value={constraints.max_consecutive_losses}
                                        onChange={(e) => handleInputChange('max_consecutive_losses', e.target.value)}
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        "Force a break if I lose <strong>{constraints.max_consecutive_losses}</strong> times in a row."
                                    </p>
                                </div>

                            </div>

                            <div className="p-6 bg-muted/30 border-t border-border flex items-center justify-between">
                                {message ? (
                                    <div className={`text-sm font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                                        {message.text}
                                    </div>
                                ) : (
                                    <div className="text-xs text-muted-foreground">
                                        Changes apply immediately to the Behavior Agent.
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={saving}
                                    className={`inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10 px-8 py-2 ${saving ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90"
                                        }`}
                                >
                                    {saving ? (
                                        <>
                                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            Saving...
                                        </>
                                    ) : "Save Constitution"}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* Explainer / Psychology Panel */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
                            <h3 className="font-bold text-lg mb-2 text-primary">🧠 Why this works</h3>
                            <p className="text-sm text-foreground/80 mb-4">
                                In psychology, this is called a <strong>"Pre-Commitment Device"</strong>.
                            </p>
                            <p className="text-sm text-foreground/80">
                                Humans are bad at willpower in the heat of the moment. By setting these "Iron Rules" now (while you are calm), you authorize the AI to act as your rational brain later.
                            </p>
                        </div>

                        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                            <h3 className="font-semibold mb-4">AI Intervention Preview</h3>
                            <div className="space-y-4">
                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm">
                                    <div className="font-bold text-red-600 dark:text-red-400 mb-1 flex items-center gap-2">
                                        <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                                        DAILY LOSS LIMIT
                                    </div>
                                    <p className="opacity-90">
                                        "Hey {selectedUser.name.split(' ')[0]}, I'm flagging this because <strong>you set this rule yourself</strong>. You hit your max loss limit of ${constraints.max_daily_loss}. To respect your own plan, we need to stop."
                                    </p>
                                </div>

                                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm">
                                    <div className="font-bold text-yellow-600 dark:text-yellow-400 mb-1 flex items-center gap-2">
                                        <span className="inline-block w-2 h-2 rounded-full bg-yellow-500"></span>
                                        TILT STREAK
                                    </div>
                                    <p className="opacity-90">
                                        "Cooling down. You hit {constraints.max_consecutive_losses} losses in a row. Walk away for 15 mins."
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}
