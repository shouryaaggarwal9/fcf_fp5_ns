"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/supabase/client";
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
  const supabase = createClient();

  // Selected Stock & Timeframe state
  const [selectedSymbol, setSelectedSymbol] = useState<string>("RELIANCE");
  const [timeframe, setTimeframe] = useState<TimeFrame>("5m");

  // Simulation Clock state
  const [virtualTime, setVirtualTime] = useState<string>(
    "2024-01-01T09:45:00.000Z",
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  // Market & Financial Data State
  const [candles, setCandles] = useState<HistoricalCandle[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 1. Authenticate or Setup Demo User Session
  useEffect(() => {
    async function initUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setUserId(user.id);
      } else {
        // Sign in anonymously or with fallback demo credentials for the simulator
        const { data: anonData } = await supabase.auth.signInAnonymously();
        if (anonData?.user) {
          setUserId(anonData.user.id);
        }
      }
    }
    initUser();
  }, [supabase]);

  // 2. Fetch User Financial Ledger (Wallet, Positions, Orders)
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

    if (walletRes.data) {
      setWallet(walletRes.data as Wallet);
    } else {
      // Create default wallet if newly registered
      const { data: newWallet } = await supabase
        .from("wallets")
        .insert({
          user_id: userId,
          cash_balance: 1000000.0,
          locked_margin: 0.0,
        })
        .select()
        .single();
      if (newWallet) setWallet(newWallet as Wallet);
    }

    if (positionsRes.data) setPositions(positionsRes.data as Position[]);
    if (ordersRes.data) setOrders(ordersRes.data as Order[]);
  }, [userId, supabase]);

  // 3. Load Historical Candles for Active Symbol up to Virtual Time
  const fetchCandles = useCallback(async () => {
    const { data, error } = await supabase
      .from("historical_candles")
      .select("*")
      .eq("symbol", selectedSymbol)
      .eq("timeframe", timeframe)
      .lte("timestamp", virtualTime)
      .order("timestamp", { ascending: true })
      .limit(100);

    if (!error && data) {
      setCandles(data as HistoricalCandle[]);
    }
  }, [selectedSymbol, timeframe, virtualTime, supabase]);

  // 4. Compute Live Watchlist Quotes across all 10 symbols
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

  // Initial Data Load
  useEffect(() => {
    async function loadInitial() {
      setIsLoading(true);
      await Promise.all([fetchCandles(), fetchQuotes(), fetchUserData()]);
      setIsLoading(false);
    }
    loadInitial();
  }, [fetchCandles, fetchQuotes, fetchUserData]);

  // 5. Advance Simulation Virtual Time (+5 minutes step) & Reconcile Orders
  const stepForward = useCallback(async () => {
    const nextDate = new Date(new Date(virtualTime).getTime() + 5 * 60 * 1000);
    const nextTimeIso = nextDate.toISOString();
    setVirtualTime(nextTimeIso);

    // Fetch newly reached candles for matching engine check
    const { data: newCandles } = await supabase
      .from("historical_candles")
      .select("*")
      .eq("timeframe", "5m")
      .eq("timestamp", nextTimeIso);

    if (newCandles && newCandles.length > 0 && userId) {
      await tradingService.reconcilePendingOrders(
        userId,
        newCandles as HistoricalCandle[],
      );
      await fetchUserData();
    }
  }, [virtualTime, userId, supabase, fetchUserData]);

  // Current market price of selected symbol
  const activeQuote = quotes[selectedSymbol];
  const currentPrice =
    activeQuote?.currentPrice ?? NSE_STOCKS[selectedSymbol]?.basePrice ?? 1000;

  return (
    <div className="flex flex-col min-h-screen bg-[#0b0e14] text-slate-100 font-sans">
      {/* Top Navbar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#21262d] bg-[#161b22]">
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

        {/* Global Virtual Clock */}
        <div className="w-auto">
          <VirtualClock
            currentVirtualTime={virtualTime}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
            onStepForward={stepForward}
            onSpeedChange={(speed) => setPlaybackSpeed(speed)}
          />
        </div>
      </header>

      {/* Main Terminal Workspace Layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 max-w-400 mx-auto w-full">
        {/* Left Column: 10 NSE Stocks Watchlist (3 cols) */}
        <section className="lg:col-span-3 h-175">
          <Watchlist
            selectedSymbol={selectedSymbol}
            onSelectSymbol={(sym) => setSelectedSymbol(sym)}
            quotes={quotes}
          />
        </section>

        {/* Center Column: Interactive Chart + Portfolio / Orders (6 cols) */}
        <section className="lg:col-span-6 flex flex-col gap-3">
          <div className="h-130">
            <TradingChart
              candles={candles}
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

        {/* Right Column: Order Entry Desk (3 cols) */}
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
