"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const ScreenSharePanel = dynamic(
    () => import("./ScreenSharePanel").then((mod) => mod.ScreenSharePanel),
    { ssr: false }
);

export function Sidebar() {
    const pathname = usePathname();

    const isActive = (path: string) => pathname === path;

    const navItems = [
        {
            path: "/",
            label: "Dashboard",
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="7" height="9" x="3" y="3" rx="1" />
                    <rect width="7" height="5" x="14" y="3" rx="1" />
                    <rect width="7" height="9" x="14" y="12" rx="1" />
                    <rect width="7" height="5" x="3" y="16" rx="1" />
                </svg>
            ),
        },
        {
            path: "/social",
            label: "Social Media Generator",
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" x2="12" y1="2" y2="15" />
                </svg>
            ),
        },
        {
            path: "/history",
            label: "Trading History",
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v5h5" />
                    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                    <path d="M12 7v5l4 2" />
                </svg>
            ),
        },
    ];

    return (
        <aside className="sidebar-container">
            {/* Logo / Brand */}
            <div className="sidebar-brand">
                <div className="sidebar-logo">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        {/* Magnifying glass */}
                        <circle cx="10.5" cy="10.5" r="7" stroke="#BEC2FF" strokeWidth="1.5" />
                        <path d="M16 16l5 5" stroke="#BEC2FF" strokeWidth="2" />
                        {/* Chart line inside the lens */}
                        <polyline points="6,13 8.5,9 11,11 14,7" stroke="#85E0CE" strokeWidth="1.5" fill="none" />
                    </svg>
                </div>
                <div className="sidebar-brand-text">
                    <h1 className="sidebar-title">TradeLens</h1>
                    <p className="sidebar-subtitle">Trading & Assistant</p>
                </div>
            </div>

            {/* Navigation */}
            <nav className="sidebar-nav">
                {navItems.map((item) => (
                    <Link
                        key={item.path}
                        href={item.path}
                        className={`sidebar-nav-item ${isActive(item.path) ? "active" : ""}`}
                    >
                        <span className="sidebar-nav-icon">{item.icon}</span>
                        <span className="sidebar-nav-label">{item.label}</span>
                    </Link>
                ))}
            </nav>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Screen Share Panel Widget */}
            <ScreenSharePanel />

            {/* Bottom Actions */}
            <div className="sidebar-bottom">
                <Link href="/profile" className="sidebar-bottom-btn w-full text-left">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                    </svg>
                    Profile
                </Link>
                <button className="sidebar-bottom-btn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                    Settings
                </button>
            </div>
        </aside>
    );
}

