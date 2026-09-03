"use client";

import React, { useState, useEffect, useCallback } from "react";
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
import {
  getHistoricalSession,
  getDeterministicCandle,
} from "../features/market-data/engine";

export default function TradingTerminalPage() {
  const router = useRouter();
  const supabase = createClient();

  const [selectedSymbol, setSelectedSymbol] = useState<string>("RELIANCE");
  const [timeframe, setTimeframe] = useState<TimeFrame>("5m");

  // Aligned to 09:15:00 AM IST (03:45:00 UTC)
  const [virtualTime, setVirtualTime] = useState<string>(
    "2024-01-01T03:45:00.000Z",
  );

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

  // 3. Load deterministic quotes
  const updateQuotes = useCallback(() => {
    const now = new Date();
    const newQuotes: Record<string, StockQuote> = {};

    for (const symbol of SUPPORTED_SYMBOLS) {
      const meta = NSE_STOCKS[symbol];
      const history = getHistoricalSession(symbol, now, 2);
      if (history.length > 0) {
        const latest = history[history.length - 1];
        const previous = history[history.length - 2] || latest;
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
  }, []);

  // 1. Deterministic Chart Initialization & Offline Catch-Up
  useEffect(() => {
    if (!userId || !selectedSymbol) return;

    async function initializeChart() {
      const now = new Date();
      const history = getHistoricalSession(selectedSymbol, now, 100);
      setCandles(history);
      updateQuotes();

      if (history.length > 0) {
        setActiveBar(history[history.length - 1]);
        await tradingService.reconcilePendingOrders(userId, history);
      }
      await fetchUserData();
    }

    initializeChart();
  }, [userId, selectedSymbol, fetchUserData, updateQuotes]);

  // 2. Real-Time Live Sync & Micro-Ticking
  useEffect(() => {
    if (!userId || candles.length === 0) return;

    const interval = setInterval(async () => {
      const now = new Date();
      setVirtualTime(now.toISOString());
      updateQuotes();

      setActiveBar((prev) => {
        if (!prev) return null;

        const current5mBoundary =
          now.getTime() - (now.getTime() % (5 * 60 * 1000));
        const prev5mBoundary = new Date(prev.timestamp).getTime();

        if (current5mBoundary > prev5mBoundary) {
          const newCandle = getDeterministicCandle(
            selectedSymbol,
            new Date(current5mBoundary),
            "5m",
          );
          tradingService
            .reconcilePendingOrders(userId, [newCandle])
            .then(() => fetchUserData());
          setCandles((current) => [...current, newCandle]);
          return newCandle;
        }

        const volatility = prev.close * 0.0001;
        const delta = (Math.random() - 0.5) * volatility;
        const newClose = Math.round((prev.close + delta) * 20) / 20;
        const newHigh = Math.max(prev.high, newClose);
        const newLow = Math.min(prev.low, newClose);
        const newVol = prev.volume + Math.floor(Math.random() * 5);

        return {
          ...prev,
          high: newHigh,
          low: newLow,
          close: newClose,
          volume: newVol,
        };
      });

      const istMinutes = (now.getUTCMinutes() + 30) % 60;
      const istSeconds = now.getUTCSeconds();
      const istHours =
        (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) %
        24;
      if (istHours === 15 && istMinutes === 15 && istSeconds === 0) {
        const { data: misPositions } = await supabase
          .from("positions")
          .select("*")
          .eq("user_id", userId)
          .eq("product_type", "MIS")
          .gt("quantity", 0);

        if (misPositions && misPositions.length > 0) {
          for (const pos of misPositions) {
            const exitPrice =
              getDeterministicCandle(
                pos.symbol,
                new Date(now.getTime() - (now.getTime() % (5 * 60 * 1000))),
                "5m",
              ).close || pos.average_buy_price;
            await tradingService.squareOff(
              userId,
              pos.symbol,
              "MIS",
              exitPrice,
              now.toISOString(),
            );
          }
          await fetchUserData();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    userId,
    candles.length,
    selectedSymbol,
    supabase,
    fetchUserData,
    updateQuotes,
  ]);

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
          <VirtualClock currentVirtualTime={virtualTime} />
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
