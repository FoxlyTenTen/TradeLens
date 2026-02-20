"use client";

import { Sidebar } from "@/components/Sidebar";
import { RightPanel } from "@/components/RightPanel";
import { SharedDataProvider } from "@/components/SharedDataContext";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
    return (
        <SharedDataProvider>
            <div className="relative flex h-screen overflow-hidden bg-[#DEDEE9] p-2 gap-2">
                {/* Background Blobs */}
                <div className="absolute w-[445.84px] h-[445.84px] left-[1040px] top-[11px] rounded-full z-0 pointer-events-none"
                    style={{ background: 'rgba(255, 172, 77, 0.2)', filter: 'blur(103.196px)' }} />
                <div className="absolute w-[609.35px] h-[609.35px] left-[1338.97px] top-[624.5px] rounded-full z-0 pointer-events-none"
                    style={{ background: '#C9C9DA', filter: 'blur(103.196px)' }} />
                <div className="absolute w-[609.35px] h-[609.35px] left-[670px] top-[-365px] rounded-full z-0 pointer-events-none"
                    style={{ background: '#C9C9DA', filter: 'blur(103.196px)' }} />
                <div className="absolute w-[609.35px] h-[609.35px] left-[507.87px] top-[702.14px] rounded-full z-0 pointer-events-none"
                    style={{ background: '#F3F3FC', filter: 'blur(103.196px)' }} />
                <div className="absolute w-[445.84px] h-[445.84px] left-[127.91px] top-[331px] rounded-full z-0 pointer-events-none"
                    style={{ background: 'rgba(255, 243, 136, 0.3)', filter: 'blur(103.196px)' }} />
                <div className="absolute w-[445.84px] h-[445.84px] left-[-205px] top-[802.72px] rounded-full z-0 pointer-events-none"
                    style={{ background: 'rgba(255, 172, 77, 0.2)', filter: 'blur(103.196px)' }} />

                {/* Sidebar Navigation */}
                <Sidebar />

                {/* Main Content Area */}
                <div className="flex flex-1 overflow-hidden z-10 gap-2">
                    {/* Center: Page-specific content */}
                    <div className="w-[50%] flex-shrink-0 flex flex-col overflow-hidden rounded-lg">
                        {children}
                    </div>

                    {/* Right: Persistent Chat + Visualizations */}
                    <RightPanel />
                </div>
            </div>
        </SharedDataProvider>
    );
}
