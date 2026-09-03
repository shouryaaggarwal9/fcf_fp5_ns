// features/terminal/useTradingEngine.ts
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  HistoricalCandle,
  Order,
  Position,
  Wallet,
  TimeFrame,
} from "@/lib/types/database";
import {
  NSE_STOCKS,
  SUPPORTED_SYMBOLS,
} from "@/features/market-data/constants";
import { StockQuote } from "@/features/market-data/Watchlist";
import { tradingService } from "@/features/trading-engine/service";
import {
  getHistoricalSession,
  getDeterministicCandle,
} from "@/features/market-data/engine";
import { evaluateOrderAgainstCandle } from "@/features/trading-engine/matching";

export function useTradingEngine() {
  const router = useRouter();
  const supabase = createClient();

  // State
  const [selectedSymbol, setSelectedSymbol] = useState<string>("RELIANCE");
  const [timeframe, setTimeframe] = useState<TimeFrame>("5m");
  const [virtualTime, setVirtualTime] = useState<string>(
    "2024-01-01T03:45:00.000Z",
  );
  const [activeBar, setActiveBar] = useState<HistoricalCandle | null>(null);
  const [candles, setCandles] = useState<HistoricalCandle[]>([]);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");

  // Refs for pure intervals (prevents stale closures)
  const ordersRef = useRef<Order[]>([]);
  const symbolRef = useRef<string>("RELIANCE");
  const quotesRef = useRef<Record<string, StockQuote>>({});
  const activeBarRef = useRef<HistoricalCandle | null>(null);

  useEffect(() => {
    ordersRef.current = orders;
    symbolRef.current = selectedSymbol;
    quotesRef.current = quotes;
    activeBarRef.current = activeBar;
  }, [orders, selectedSymbol, quotes, activeBar]);

  // Auth
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

  // Fetch Ledger
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

  // Quotes Update
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
        newQuotes[symbol] = {
          symbol,
          currentPrice: Number(latest.close),
          openPrice: Number(latest.open),
          change: Math.round(change * 100) / 100,
          changePercent: Math.round((change / previous.close) * 10000) / 100,
        };
      }
    }
    setQuotes(newQuotes);
  }, []);

  // Initialization
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

  // Main Engine Loop
  useEffect(() => {
    if (!userId || candles.length === 0) return;
    const interval = setInterval(async () => {
      const now = new Date();
      setVirtualTime(now.toISOString());
      updateQuotes();

      const prev = activeBarRef.current;
      if (!prev) return;

      const current5mBoundary =
        now.getTime() - (now.getTime() % (5 * 60 * 1000));
      const prev5mBoundary = new Date(prev.timestamp).getTime();

      let newTick: HistoricalCandle;
      let isNewBoundary = false;

      // 1. Calculate the math SYNCHRONOUSLY outside of setState
      if (current5mBoundary > prev5mBoundary) {
        newTick = getDeterministicCandle(
          symbolRef.current,
          new Date(current5mBoundary),
          "5m",
        );
        isNewBoundary = true;
      } else {
        const delta = (Math.random() - 0.5) * (prev.close * 0.0001);
        const newClose = Math.round((prev.close + delta) * 20) / 20;
        newTick = {
          ...prev,
          high: Math.max(prev.high, newClose),
          low: Math.min(prev.low, newClose),
          close: newClose,
          volume: prev.volume + Math.floor(Math.random() * 5),
          id: 0,
          symbol: symbolRef.current,
          timeframe: "5m",
        };
      }

      // 2. Commit to State
      setActiveBar(newTick);
      if (isNewBoundary) {
        setCandles((c) =>
          c.some((x) => x.timestamp === newTick.timestamp)
            ? c
            : [...c, newTick],
        );
      }

      // 3. Evaluate local matches using the synchronously calculated tick
      const pending = ordersRef.current.filter(
        (o) => o.status === "PENDING" || o.status === "TRIGGER_PENDING",
      );

      if (pending.length > 0) {
        let requiresDbSync = false;
        for (const order of pending) {
          const match = evaluateOrderAgainstCandle(order, newTick);
          if (match) {
            try {
              await tradingService.executeFill(
                match.orderId,
                match.fillPrice,
                match.fillTime,
              );
              requiresDbSync = true;
            } catch (error) {
              console.error("Order Fill Error:", error);
            }
          }
        }
        if (requiresDbSync) await fetchUserData();
      }

      // 4. MIS Day-End Check
      const istHours =
        (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) %
        24;
      if (
        istHours === 23 &&
        (now.getUTCMinutes() + 30) % 60 === 45 &&
        now.getUTCSeconds() === 0
      ) {
        const { data } = await supabase
          .from("positions")
          .select("*")
          .eq("user_id", userId)
          .eq("product_type", "MIS")
          .gt("quantity", 0);
        if (data && data.length > 0) {
          for (const pos of data as Position[]) {
            const exitPrice =
              quotesRef.current[pos.symbol]?.currentPrice ||
              pos.average_buy_price;
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
  }, [userId, candles.length > 0, supabase, fetchUserData, updateQuotes]);

  // Actions
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleSquareOff = useCallback(
    async (position: Position, exitPrice: number) => {
      await tradingService.squareOff(
        userId,
        position.symbol,
        position.product_type,
        exitPrice,
        new Date().toISOString(),
      );
      await fetchUserData();
    },
    [userId, fetchUserData],
  );

  const handleCancelOrder = async (orderId: string) => {
    await tradingService.cancelOrder(userId, orderId);
    await fetchUserData();
  };

  return {
    state: {
      userId,
      userEmail,
      selectedSymbol,
      timeframe,
      virtualTime,
      activeBar,
      candles,
      quotes,
      wallet,
      positions,
      orders,
    },
    actions: {
      setSelectedSymbol,
      setTimeframe,
      fetchUserData,
      handleSignOut,
      handleSquareOff,
      handleCancelOrder,
    },
  };
}
