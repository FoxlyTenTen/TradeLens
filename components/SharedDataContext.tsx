"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { CoachData } from "@/components/types";

interface SharedDataContextType {
    coachData: CoachData | null;
    setCoachData: (data: CoachData | null) => void;
}

const SharedDataContext = createContext<SharedDataContextType>({
    coachData: null,
    setCoachData: () => { },
});

export function SharedDataProvider({ children }: { children: ReactNode }) {
    const [coachData, setCoachData] = useState<CoachData | null>(null);

    return (
        <SharedDataContext.Provider value={{ coachData, setCoachData }}>
            {children}
        </SharedDataContext.Provider>
    );
}

export function useSharedData() {
    return useContext(SharedDataContext);
}
