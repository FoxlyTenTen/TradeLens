"use client";

import { useState } from "react";
import TradingViewWidget from "@/components/TradingViewWidget";
import RealTimeIndicators, { type Asset } from "@/components/RealTimeIndicators";

export default function Home() {
  const [selectedAsset, setSelectedAsset] = useState<Asset>('BTC-USD');
  const tradingViewSymbol = selectedAsset === 'ETH-USD' ? 'COINBASE:ETHUSD' : 'COINBASE:BTCUSD';

  return (
    <>
      {/* TradingView Chart */}
      <div className="flex-1 min-h-[300px] w-full border-b border-white/20 bg-white rounded-t-lg">
        <TradingViewWidget symbol={tradingViewSymbol} />
      </div>

      {/* Real-Time Indicators — below the chart */}
      <div className="w-full bg-white/50 backdrop-blur-md shrink-0 rounded-b-lg">
        <RealTimeIndicators
          asset={selectedAsset}
          onAssetChange={setSelectedAsset}
        />
      </div>
    </>
  );
}
