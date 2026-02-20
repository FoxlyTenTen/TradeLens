"use client";

import React, { useState, useEffect, useRef } from 'react';

// ---------------------------------------
// UTILITIES & INDICATOR LOGIC (Ported from binance.py)
// ---------------------------------------

const MAX_POINTS = 1200; // keep last N closes (updated from 600)
const RSI_PERIOD = 14;   // Wilder RSI
const BB_PERIOD = 20;
const BB_STD = 2.0;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const VOL_WINDOW = 60;   // rolling window of log returns

function fmt(x: number | null | undefined, nd: number = 4): string {
  if (x == null) return "";
  return x.toFixed(nd);
}

function ema(prev_ema: number | null, value: number, period: number): number {
  const k = 2.0 / (period + 1.0);
  return prev_ema === null ? value : (value * k + prev_ema * (1.0 - k));
}

function bollinger_from_closes(closes: number[], period: number, num_std: number): [number, number, number] | null {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  const mean = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  return [mean - num_std * std, mean, mean + num_std * std];
}

function volatility_from_returns(logrets: number[], window: number): number | null {
  if (logrets.length < window) return null;
  const w = logrets.slice(-window);
  const mean = w.reduce((a, b) => a + b, 0) / window;
  const variance = w.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window;
  return Math.sqrt(variance);
}

async function fetchKlinesCloses(symbol: string, interval: string, limit: number) {
  // Call our own API route to avoid CORS errors
  const res = await fetch(`/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Klines failed ${res.status}`);
  const data = await res.json();
  // data is [[time, open, high, low, close, vol, ...], ...]
  // We want the close (index 4)
  return (data as any[]).map((k) => parseFloat(k[4])).filter((x) => Number.isFinite(x));
}

class SymbolState {
  symbol: string;
  last_trade_price: number | null = null;
  last_trade_time_ms: number | null = null;

  // Bar building
  current_bar_sec: number | null = null;
  current_close: number | null = null;

  // Series
  closes: number[] = [];
  logrets: number[] = [];

  // MACD EMA state
  ema_fast: number | null = null;
  ema_slow: number | null = null;
  macd_signal_ema: number | null = null;

  // Wilder RSI state (RMA smoothing)
  rsi_avg_gain: number | null = null;
  rsi_avg_loss: number | null = null;
  rsi_seed_diffs: { gain: number, loss: number }[] = []; // Array of {gain, loss} objects
  rsi: number | null = null;

  // Computed values
  bb_lower: number | null = null;
  bb_mid: number | null = null;
  bb_upper: number | null = null;
  macd: number | null = null;
  macd_signal: number | null = null;
  macd_hist: number | null = null;
  vol: number | null = null;

  // Extra for UI
  start_price: number | null = null; // to calc session change

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  on_trade(price: number, trade_time_ms: number) {
    this.last_trade_price = price;
    this.last_trade_time_ms = trade_time_ms;

    if (this.start_price === null) this.start_price = price;

    const sec = Math.floor(trade_time_ms / 1000);

    if (this.current_bar_sec === null) {
      this.current_bar_sec = sec;
      this.current_close = price;
      return;
    }

    if (sec === this.current_bar_sec) {
      this.current_close = price;
      return;
    }

    // finalize previous bar close
    if (this.current_close !== null) {
      this._append_close(this.current_close);
    }

    this.current_bar_sec = sec;
    this.current_close = price;
  }

  _append_close(close: number) {
    // log return vs previous close
    if (this.closes.length > 0) {
      const prev = this.closes[this.closes.length - 1];
      if (prev > 0 && close > 0) {
        this.logrets.push(Math.log(close / prev));
        if (this.logrets.length > MAX_POINTS) this.logrets.shift();
      }

      // update Wilder RSI using the price change
      const diff = close - prev;
      const gain = diff > 0 ? diff : 0.0;
      const loss = diff < 0 ? -diff : 0.0;
      this._update_wilder_rsi(gain, loss);
    }

    this.closes.push(close);
    if (this.closes.length > MAX_POINTS) this.closes.shift();

    // BB
    const bb = bollinger_from_closes(this.closes, BB_PERIOD, BB_STD);
    if (bb) {
      [this.bb_lower, this.bb_mid, this.bb_upper] = bb;
    }

    // Volatility
    this.vol = volatility_from_returns(this.logrets, VOL_WINDOW);

    // MACD
    this.ema_fast = ema(this.ema_fast, close, MACD_FAST);
    this.ema_slow = ema(this.ema_slow, close, MACD_SLOW);

    if (this.ema_fast !== null && this.ema_slow !== null) {
      this.macd = this.ema_fast - this.ema_slow;
      this.macd_signal_ema = ema(this.macd_signal_ema, this.macd, MACD_SIGNAL);
      this.macd_signal = this.macd_signal_ema;
      if (this.macd_signal !== null) {
        this.macd_hist = this.macd - this.macd_signal;
      }
    }
  }

  _update_wilder_rsi(gain: number, loss: number) {
    // Wilder RSI:
    // - Seed avg_gain/avg_loss with SMA of first N gains/losses
    // - Then RMA update: avg = (prev_avg*(N-1) + current) / N
    const N = RSI_PERIOD;

    // Seed phase: collect first N gain/loss samples
    if (this.rsi_avg_gain === null || this.rsi_avg_loss === null) {
      this.rsi_seed_diffs.push({ gain, loss });
      if (this.rsi_seed_diffs.length === N) {
        const sum_g = this.rsi_seed_diffs.reduce((acc, val) => acc + val.gain, 0);
        const sum_l = this.rsi_seed_diffs.reduce((acc, val) => acc + val.loss, 0);
        this.rsi_avg_gain = sum_g / N;
        this.rsi_avg_loss = sum_l / N;
        this._compute_rsi_from_avgs();
        // Clear seed buffer not strictly necessary in JS but good for cleanup, 
        // though logic above checks null avgs so it won't re-enter this block.
      }
      return;
    }

    // RMA smoothing
    this.rsi_avg_gain = (this.rsi_avg_gain * (N - 1) + gain) / N;
    this.rsi_avg_loss = (this.rsi_avg_loss * (N - 1) + loss) / N;
    this._compute_rsi_from_avgs();
  }

  _compute_rsi_from_avgs() {
    if (this.rsi_avg_gain === null || this.rsi_avg_loss === null) {
      this.rsi = null;
      return;
    }
    if (this.rsi_avg_loss === 0) {
      this.rsi = 100.0;
      return;
    }
    const rs = this.rsi_avg_gain / this.rsi_avg_loss;
    this.rsi = 100.0 - (100.0 / (1.0 + rs));
  }

  getSnapshot() {
    return {
      price: this.last_trade_price,
      change: this.start_price && this.last_trade_price
        ? ((this.last_trade_price - this.start_price) / this.start_price) * 100
        : 0,
      RSI: this.rsi,
      MACD: {
        histogram: this.macd_hist,
        signal: this.macd_signal,
        MACD: this.macd,
        // Aliases for compatibility with existing UI if needed
        MACD_12_26_9: this.macd,
        MACDs_12_26_9: this.macd_signal,
        MACDh_12_26_9: this.macd_hist
      },
      BB: {
        BBU_20_2: this.bb_upper,
        BBL_20_2: this.bb_lower,
        BBM_20_2: this.bb_mid,
        BBP_20_2: (this.last_trade_price && this.bb_upper && this.bb_lower && (this.bb_upper - this.bb_lower) !== 0)
          ? (this.last_trade_price - this.bb_lower) / (this.bb_upper - this.bb_lower)
          : null
      },
      ATR: null, // Not in binance.py standard logic, can leave null or impl
      Vol: this.vol
    };
  }
}

// ---------------------------------------
// COMPONENT
// ---------------------------------------

export type Asset = 'BTC-USD' | 'ETH-USD';
type Timeframe = '1s' | '1m' | '15m' | '1H'; // '1s' added for realtime truth

interface RealTimeIndicatorsProps {
  asset: Asset;
  onAssetChange: (asset: Asset) => void;
}

interface ActiveIndicator {
  id: string;
  type: string;
  params?: any;
}

export default function RealTimeIndicators({ asset, onAssetChange }: RealTimeIndicatorsProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1s');
  const [alert, setAlert] = useState<string | null>(null);
  const [marketData, setMarketData] = useState<any>({ price: 0, change: 0 });
  const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([
    { id: '1', type: 'RSI' },
    { id: '2', type: 'MACD' },
    { id: '3', type: 'BB' },
    { id: '4', type: 'Vol' }
  ]);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Ref to hold state for all symbols to avoid re-renders on every trade
  const statesRef = useRef<Record<string, SymbolState>>({
    'BTCUSDT': new SymbolState('BTCUSDT'),
    'ETHUSDT': new SymbolState('ETHUSDT')
  });

  const [availableIndicators] = useState<string[]>([
    'RSI', 'MACD', 'BB', 'Vol'
  ]);

  const addIndicator = (type: string) => {
    setActiveIndicators(prev => [...prev, { id: Date.now().toString(), type }]);
    setShowAddMenu(false);
  };

  const removeIndicator = (id: string) => {
    setActiveIndicators(prev => prev.filter(i => i.id !== id));
  };

  // WebSocket Effect
  useEffect(() => {
    // binance.py stream: wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade
    const streams = ['btcusdt@trade', 'ethusdt@trade'];
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams.join('/')}`;
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Connected to Binance WS');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const data = msg.data; // { e: 'trade', s: 'BTCUSDT', p: '...', ... }
          const sym = data.s;
          const price = parseFloat(data.p);
          const time = data.T;

          if (statesRef.current[sym]) {
            statesRef.current[sym].on_trade(price, time);
          }
        } catch (e) {
          console.error('WS Parse Error', e);
        }
      };

      ws.onerror = (e) => {
        console.log('WS Error', e);
      };

      ws.onclose = () => {
        console.log('WS Closed, reconnecting...');
        reconnectTimeout = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimeout);
    };
  }, []);

  // Fetch History & Seed Indicators (CORS Fix)
  useEffect(() => {
    const loadHistory = async () => {
      const symMap: Record<string, string> = {
        'BTC-USD': 'BTCUSDT',
        'ETH-USD': 'ETHUSDT'
      };
      const rawSym = symMap[asset];
      if (!statesRef.current[rawSym]) return;

      // Only fetch if we don't have enough history or want to ensure fresh start
      // Here assuming we fetch if closes are empty
      if (statesRef.current[rawSym].closes.length === 0) {
        try {
          // Use 1m intervals for history as a baseline
          // Note: This seeds the indicators. Live updates are currently 1s aggregation.
          const closes = await fetchKlinesCloses(rawSym, '1m', 1000);

          // Populate state
          closes.forEach(c => statesRef.current[rawSym]._append_close(c));

          console.log(`Seeded ${rawSym} with ${closes.length} historical points.`);
        } catch (e) {
          console.error("History fetch error", e);
        }
      }
    };

    loadHistory();
  }, [asset]);

  // UI Refresh Loop (8Hz like binance.py or slightly slower for React)
  useEffect(() => {
    const interval = setInterval(() => {
      const symMap: Record<string, string> = {
        'BTC-USD': 'BTCUSDT',
        'ETH-USD': 'ETHUSDT'
      };
      const rawSym = symMap[asset];
      if (statesRef.current[rawSym]) {
        const snap = statesRef.current[rawSym].getSnapshot();
        setMarketData(snap);
        setLastUpdated(new Date());
      }
    }, 125); // 8Hz = 125ms

    return () => clearInterval(interval);
  }, [asset]);

  // Alerts
  useEffect(() => {
    if (!marketData || !marketData.price) return;
    const rsi = marketData.RSI;

    let newAlert = null;
    if (typeof rsi === 'number') {
      if (rsi > 70) newAlert = "🔴 OVERBOUGHT! RSI > 70";
      else if (rsi < 30) newAlert = "🟢 OVERSOLD! RSI < 30";
    }

    if (newAlert) setAlert(newAlert);
    else setAlert(null); // Clear if normal
  }, [marketData.RSI]); // Only check when RSI changes

  const getRsiColor = (val: number | null | undefined) => {
    if (val == null) return 'text-[#57575B]';
    if (val >= 70) return 'text-red-500 font-bold';
    if (val <= 30) return 'text-green-500 font-bold';
    return 'text-[#57575B]';
  };

  const getMacdColor = (val: number) => val >= 0 ? 'text-green-500' : 'text-red-500';

  const getValue = (key: string) => {
    // Mapping types to marketData keys
    if (key === 'Vol') return marketData.Vol;
    return marketData[key];
  };

  const filteredIndicators = availableIndicators.filter(i =>
    i.includes(searchTerm.toUpperCase())
  );

  return (
    <div className="flex flex-col h-full bg-white/50 p-4 font-sans text-[#010507]">
      {/* Header Controls */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex justify-between items-center bg-white p-2 rounded-md shadow-sm border border-[#DBDBE5]">
          <select
            value={asset}
            onChange={(e) => onAssetChange(e.target.value as Asset)}
            className="bg-transparent font-semibold text-lg focus:outline-none cursor-pointer"
          >
            <option value="BTC-USD">BTC-USD</option>
            <option value="ETH-USD">ETH-USD</option>
          </select>
          <div className={`text-sm font-mono ${marketData.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {marketData.change >= 0 ? '+' : ''}{marketData.change ? marketData.change.toFixed(2) : '0.00'}%
          </div>
        </div>

        <div className="flex justify-between gap-1 bg-[#F3F3FC] p-1 rounded-md">
          {(['1s', '1m', '15m', '1H'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`flex-1 py-1 text-xs rounded-sm transition-all ${timeframe === tf
                ? 'bg-white shadow-sm font-semibold text-[#6E44FF]'
                : 'text-[#838389] hover:bg-white/50'
                }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Price Big Display */}
      <div className="mb-6 text-center">
        {!marketData.price ? (
          <div className="animate-pulse h-10 w-32 bg-gray-200 rounded mx-auto"></div>
        ) : (
          <span className="text-3xl font-bold tracking-tight">
            ${marketData.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
        <div className="flex flex-col items-center mt-1">
          <p className="text-xs text-[#838389] uppercase tracking-wider">
            Live Price (Binance Stream)
          </p>
          {lastUpdated && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>

      {/* Indicators Grid */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-4 custom-scrollbar max-h-[380px]">

        {activeIndicators.map((indicator) => {
          const type = indicator.type;

          if (type === 'RSI') {
            const val = marketData.RSI;
            return (
              <div key={indicator.id} className="relative group bg-white rounded-lg p-4 border border-[#DBDBE5] shadow-sm">
                <button onClick={() => removeIndicator(indicator.id)} className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 18 12" /></svg></button>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-[#57575B]">{type}</span>
                  <span className={`text-lg ${getRsiColor(val)}`}>{typeof val === 'number' ? val.toFixed(1) : 'N/A'}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5 dark:bg-gray-700">
                  <div className="bg-[#6E44FF] h-1.5 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, val || 0))}%` }}></div>
                </div>
              </div>
            );
          }

          if (type === 'MACD') {
            const m = marketData.MACD || {};
            const hist = m.histogram || 0;
            const line = m.MACD || 0;
            const signal = m.signal || 0;

            return (
              <div key={indicator.id} className="relative group bg-white rounded-lg p-4 border border-[#DBDBE5] shadow-sm">
                <button onClick={() => removeIndicator(indicator.id)} className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 18 12" /></svg></button>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium text-[#57575B]">{type}</span>
                  <span className={`text-lg font-semibold ${getMacdColor(hist)}`}>
                    {hist.toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-[#838389] mt-2">
                  <div className='flex justify-between border-b border-gray-100 pb-1'><span>Signal</span><span>{signal.toFixed(3)}</span></div>
                  <div className='flex justify-between border-b border-gray-100 pb-1'><span>Line</span><span>{line.toFixed(3)}</span></div>
                </div>
              </div>
            );
          }

          if (type === 'BB') {
            const bb = marketData.BB || {};
            const pB = bb.BBP_20_2;
            return (
              <div key={indicator.id} className="relative group bg-white rounded-lg p-4 border border-[#DBDBE5] shadow-sm">
                <button onClick={() => removeIndicator(indicator.id)} className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 18 12" /></svg></button>
                <div className="text-sm font-medium text-[#57575B] mb-2">{type}</div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-[#838389]">Pos %B</span>
                  <span className="text-sm font-mono">{typeof pB === 'number' ? pB.toFixed(2) : 'N/A'}</span>
                </div>
                <div className="relative w-full h-4 bg-gray-100 rounded-sm overflow-hidden mb-2">
                  <div className="absolute top-0 bottom-0 left-[20%] right-[20%] bg-blue-100/50 border-x border-blue-200"></div>
                  <div className="absolute top-0 bottom-0 w-0.5 bg-black" style={{ left: `${Math.min(100, Math.max(0, (pB || 0.5) * 100))}%` }}></div>
                </div>
                <div className="text-[10px] text-gray-400 flex justify-between">
                  <span>L: {bb.BBL_20_2?.toFixed(0)}</span>
                  <span>U: {bb.BBU_20_2?.toFixed(0)}</span>
                </div>
              </div>
            );
          }

          // Fallback for others like Vol
          const val = getValue(type);
          return (
            <div key={indicator.id} className="relative group bg-white rounded-lg p-4 border border-[#DBDBE5] shadow-sm flex justify-between items-center">
              <button onClick={() => removeIndicator(indicator.id)} className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 18 12" /></svg></button>
              <div>
                <div className="text-sm font-medium text-[#57575B]">{type}</div>
                <div className="text-xs text-[#838389] mt-0.5">Value</div>
              </div>
              <div className="text-lg font-mono text-[#010507] font-bold">
                {typeof val === 'number' ? val.toFixed(4) : 'N/A'}
              </div>
            </div>
          );
        })}

        {/* Add Indicator Button */}
        <div className="relative">
          {!showAddMenu ? (
            <button
              onClick={() => { setShowAddMenu(true); setSearchTerm(''); }}
              className="w-full py-3 flex items-center justify-center gap-2 border-2 border-dashed border-[#DBDBE5] rounded-lg text-[#838389] hover:border-[#6E44FF] hover:text-[#6E44FF] transition-colors bg-white/30"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
              <span className="text-sm font-medium">Add Indicator</span>
            </button>
          ) : (
            <div className="bg-white rounded-lg border border-[#DBDBE5] shadow-lg p-2 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-2 px-2 border-b border-gray-100 pb-2">
                <input
                  type="text"
                  placeholder="Search..."
                  className="text-xs w-full focus:outline-none p-1"
                  value={searchTerm}
                  autoFocus
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button onClick={() => setShowAddMenu(false)} className="text-gray-400 hover:text-gray-600 ml-2">
                  X
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto custom-scrollbar">
                {filteredIndicators.map(type => (
                  <button
                    key={type}
                    onClick={() => addIndicator(type)}
                    className="text-left px-3 py-2 text-xs text-[#57575B] hover:bg-[#F3F3FC] hover:text-[#6E44FF] rounded-md transition-colors flex items-center gap-2 truncate"
                    title={type}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-current shrink-0"></div>
                    {type}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Real Time Alert Section */}
      {alert && (
        <div className="mt-4 p-3 rounded-lg border-l-4 border-yellow-400 bg-yellow-50 shadow-md animate-in slide-in-from-bottom-2 duration-300">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-xs font-bold text-yellow-800 uppercase tracking-widest mb-1 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                REAL-TIME ALERT
              </div>
              <div className={`text-sm font-extrabold ${alert.includes('BUY') || alert.includes('ENTRY') ? 'text-green-600' : 'text-red-600'}`}>
                {alert}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

