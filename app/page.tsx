"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "../lib/supabase/client";
import {
  HistoricalCandle,
  Order,
  Position,
  Wallet,
  TimeFrame,
} from "../lib/types/database";
import {
  NSE_STOCKS,
  SUPPORTED_SYMBOLS,
} from "../features/market-data/constants";
import { Watchlist, StockQuote } from "../features/market-data/Watchlist";
import { TradingChart } from "../features/charting/TradingChart";
import { OrderForm } from "../features/trading-engine/OrderForm";
import { PortfolioPanel } from "../features/portfolio/PortfolioPanel";
import { VirtualClock } from "../features/market-data/VirtualClock";
import { tradingService } from "../features/trading-engine/service";

export default function TradingTerminalPage() {
  const router = useRouter();
  const supabase = createClient();

  const [selectedSymbol, setSelectedSymbol] = useState<string>("RELIANCE");
  const [timeframe, setTimeframe] = useState<TimeFrame>("5m");

  // Aligned to 09:15:00 AM IST (03:45:00 UTC)
  const [virtualTime, setVirtualTime] = useState<string>(
    "2024-01-01T03:45:00.000Z",
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  // Active Candle Intra-bar Tick State
  const [activeBar, setActiveBar] = useState<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null>(null);

  const [candles, setCandles] = useState<HistoricalCandle[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");

  const virtualTimeRef = useRef(virtualTime);
  virtualTimeRef.current = virtualTime;

  // 1. Session check
  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        router.push("/login");
        return;
      }

      setUserId(user.id);
      setUserEmail(user.email || "Trader");
    }

    loadUser();
  }, [supabase, router]);

  // 2. Fetch User Financial Ledger
  const fetchUserData = useCallback(async () => {
    if (!userId) return;

    const [walletRes, positionsRes, ordersRes] = await Promise.all([
      supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("positions").select("*").eq("user_id", userId),
      supabase
        .from("orders")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
    ]);

    if (walletRes.data) setWallet(walletRes.data as Wallet);
    if (positionsRes.data) setPositions(positionsRes.data as Position[]);
    if (ordersRes.data) setOrders(ordersRes.data as Order[]);
  }, [userId, supabase]);

  // 3. Load historical candles
  const fetchCandles = useCallback(async () => {
    const { data, error } = await supabase
      .from("historical_candles")
      .select("*")
      .eq("symbol", selectedSymbol)
      .eq("timeframe", timeframe)
      .lte("timestamp", virtualTime)
      .order("timestamp", { ascending: true })
      .limit(100);

    if (!error && data && data.length > 0) {
      setCandles(data as HistoricalCandle[]);
      const last = data[data.length - 1];
      setActiveBar({
        timestamp: last.timestamp,
        open: Number(last.open),
        high: Number(last.high),
        low: Number(last.low),
        close: Number(last.close),
        volume: Number(last.volume),
      });
    }
  }, [selectedSymbol, timeframe, virtualTime, supabase]);

  // 4. Load Quotes
  const fetchQuotes = useCallback(async () => {
    const newQuotes: Record<string, StockQuote> = {};

    for (const symbol of SUPPORTED_SYMBOLS) {
      const { data } = await supabase
        .from("historical_candles")
        .select("*")
        .eq("symbol", symbol)
        .eq("timeframe", "5m")
        .lte("timestamp", virtualTime)
        .order("timestamp", { ascending: false })
        .limit(2);

      const meta = NSE_STOCKS[symbol];
      if (data && data.length > 0) {
        const latest = data[0];
        const previous = data[1] || latest;
        const change = latest.close - previous.close;
        const changePercent = (change / previous.close) * 100;

        newQuotes[symbol] = {
          symbol,
          currentPrice: Number(latest.close),
          openPrice: Number(latest.open),
          change: Math.round(change * 100) / 100,
          changePercent: Math.round(changePercent * 100) / 100,
        };
      } else {
        newQuotes[symbol] = {
          symbol,
          currentPrice: meta.basePrice,
          openPrice: meta.basePrice,
          change: 0,
          changePercent: 0,
        };
      }
    }
    setQuotes(newQuotes);
  }, [virtualTime, supabase]);

  useEffect(() => {
    fetchCandles();
    fetchQuotes();
  }, [fetchCandles, fetchQuotes]);

  useEffect(() => {
    if (userId) {
      fetchUserData();
    }
  }, [userId, fetchUserData]);

  // 5. Second-by-Second Tick Engine (When Playing)
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(async () => {
      const currentMs = new Date(virtualTimeRef.current).getTime();
      // Step virtual clock forward by (1 second * playbackSpeed)
      const nextDate = new Date(currentMs + 1000 * playbackSpeed);
      const nextIso = nextDate.toISOString();
      setVirtualTime(nextIso);

      // Micro-tick price motion
      setActiveBar((prev) => {
        if (!prev) return null;
        const delta = (Math.random() - 0.49) * 0.75;
        const newClose = Math.round((prev.close + delta) * 100) / 100;
        const newHigh = Math.max(prev.high, newClose);
        const newLow = Math.min(prev.low, newClose);
        const newVol = prev.volume + Math.floor(Math.random() * 15);

        // Check active limit order triggers on tick
        if (userId) {
          const tickSyntheticCandle: HistoricalCandle = {
            id: 0,
            symbol: selectedSymbol,
            timeframe: "5m",
            timestamp: prev.timestamp,
            open: prev.open,
            high: newHigh,
            low: newLow,
            close: newClose,
            volume: newVol,
          };
          tradingService
            .reconcilePendingOrders(userId, [tickSyntheticCandle])
            .then(() => {
              fetchUserData();
            });
        }

        return {
          ...prev,
          high: newHigh,
          low: newLow,
          close: newClose,
          volume: newVol,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, selectedSymbol, userId, fetchUserData]);

  // Step 5 minutes manually (+5m button)
  const stepForward5m = useCallback(async () => {
    const nextDate = new Date(new Date(virtualTime).getTime() + 5 * 60 * 1000);
    const nextTimeIso = nextDate.toISOString();
    setVirtualTime(nextTimeIso);

    const { data: newCandles } = await supabase
      .from("historical_candles")
      .select("*")
      .eq("timeframe", "5m")
      .eq("timestamp", nextTimeIso);

    if (userId && newCandles && newCandles.length > 0) {
      await tradingService.reconcilePendingOrders(
        userId,
        newCandles as HistoricalCandle[],
      );
      await fetchUserData();
    }
  }, [virtualTime, userId, supabase, fetchUserData]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const activeQuote = quotes[selectedSymbol];
  const currentPrice =
    activeBar?.close ??
    activeQuote?.currentPrice ??
    NSE_STOCKS[selectedSymbol]?.basePrice ??
    1000;

  return (
    <div className="flex flex-col min-h-screen bg-[#0b0e14] text-slate-100 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-[#21262d] bg-[#161b22]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-emerald-600 flex items-center justify-center font-black text-white text-sm">
            N
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wider uppercase text-white">
              NSE Paper Trade Pro
            </h1>
            <span className="text-[10px] text-slate-400 font-mono">
              Audit Grade • Zero Cost Architecture
            </span>
          </div>
        </div>

        <div className="w-auto">
          <VirtualClock
            currentVirtualTime={virtualTime}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
            onStepForward={stepForward5m}
            onSpeedChange={(speed) => setPlaybackSpeed(speed)}
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-semibold text-slate-200">
              {userEmail}
            </span>
            <span className="text-[10px] font-mono text-emerald-400">
              Authenticated Trader
            </span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            title="Sign Out"
            className="flex items-center gap-1 px-3 py-1.5 rounded border border-[#30363d] bg-[#0d1117] hover:bg-[#21262d] text-slate-300 hover:text-white text-xs font-medium transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 max-w-400 mx-auto w-full items-start">
        <section className="lg:col-span-3 h-200">
          <Watchlist
            selectedSymbol={selectedSymbol}
            onSelectSymbol={(sym) => setSelectedSymbol(sym)}
            quotes={quotes}
          />
        </section>

        <section className="lg:col-span-6 flex flex-col gap-3">
          <div className="h-130">
            <TradingChart
              candles={candles}
              currentTick={activeBar}
              symbol={selectedSymbol}
              timeframe={timeframe}
              onTimeframeChange={(tf) => setTimeframe(tf)}
            />
          </div>

          <div className="w-full">
            <PortfolioPanel
              wallet={wallet}
              positions={positions}
              orders={orders}
              quotes={quotes}
            />
          </div>
        </section>

        <section className="lg:col-span-3">
          <OrderForm
            symbol={selectedSymbol}
            currentMarketPrice={currentPrice}
            virtualTime={virtualTime}
            userId={userId}
            availableCash={wallet ? Number(wallet.cash_balance) : 0}
            onOrderPlaced={() => fetchUserData()}
          />
        </section>
      </main>
    </div>
  );
}
