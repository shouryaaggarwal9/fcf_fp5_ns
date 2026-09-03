import { HistoricalCandle } from "@/lib/types/database";
import { NSE_STOCKS } from "./constants";

// 1. Core Mathematical Seed (Guarantees same output for same inputs)
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// 2. Pseudo-Random Number Generator (0.0 to 1.0)
function seededRandom(seed: number) {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// 3. The Infinite Price Generator
export function getDeterministicCandle(
  symbol: string,
  timestamp: Date,
  timeframe: "5m" | "15m" = "5m",
): HistoricalCandle {
  const meta = NSE_STOCKS[symbol];
  if (!meta) throw new Error(`Unknown symbol: ${symbol}`);

  const timeMs = timestamp.getTime();

  // Anchor the daily seed to midnight UTC so the whole day trends cohesively
  const dayAnchor = new Date(timestamp);
  dayAnchor.setUTCHours(0, 0, 0, 0);

  const baseSeed =
    hashString(symbol) + Math.floor(dayAnchor.getTime() / 100000);

  // Generate a daily macro trend (-2% to +2% movement for the day)
  const dailyTrend = (seededRandom(baseSeed) - 0.5) * 0.04;

  // Calculate how many 5m periods have elapsed since 09:15 IST (03:45 UTC)
  const marketStart = new Date(dayAnchor);
  marketStart.setUTCHours(3, 45, 0, 0);

  const elapsedMs = timeMs - marketStart.getTime();
  const elapsedPeriods = Math.max(0, Math.floor(elapsedMs / (5 * 60 * 1000)));

  // Calculate cumulative price up to this exact 5m period
  let currentOpen = meta.basePrice;

  for (let i = 0; i < elapsedPeriods; i++) {
    const prevSeed = baseSeed + marketStart.getTime() + i * 300000;
    const prevNoise = (seededRandom(prevSeed) - 0.5) * 0.006; // 0.6% max volatility per candle
    // 75 total 5m periods in an NSE trading day
    currentOpen = currentOpen * (1 + dailyTrend / 75 + prevNoise);
  }

  // Generate this specific candle's metrics
  const candleSeed = baseSeed + timeMs;
  const currentNoise = (seededRandom(candleSeed) - 0.5) * 0.006;

  const open = Math.round(currentOpen * 20) / 20; // Round to nearest 0.05 tick size
  const close =
    Math.round(open * (1 + dailyTrend / 75 + currentNoise) * 20) / 20;

  const highVariance = seededRandom(candleSeed + 1) * 0.0025;
  const lowVariance = seededRandom(candleSeed + 2) * 0.0025;

  const high = Math.round(Math.max(open, close) * (1 + highVariance) * 20) / 20;
  const low = Math.round(Math.min(open, close) * (1 - lowVariance) * 20) / 20;

  const volume = Math.floor(10000 + seededRandom(candleSeed + 3) * 50000);

  return {
    id: 0,
    symbol,
    timeframe,
    timestamp: timestamp.toISOString(),
    open,
    high,
    low,
    close,
    volume,
  };
}

// 4. Batch Generator for Chart Initialization & Offline Catch-up
export function getHistoricalSession(
  symbol: string,
  toDate: Date,
  limit: number = 75,
): HistoricalCandle[] {
  const candles: HistoricalCandle[] = [];
  const currentMs = toDate.getTime();

  // Align to nearest 5m interval
  const alignedMs = currentMs - (currentMs % (5 * 60 * 1000));

  for (let i = limit - 1; i >= 0; i--) {
    const targetDate = new Date(alignedMs - i * 5 * 60 * 1000);

    // Only generate candles during NSE hours (09:15 to 15:30 IST)
    const istHours =
      (targetDate.getUTCHours() +
        5 +
        Math.floor((targetDate.getUTCMinutes() + 30) / 60)) %
      24;
    const istMinutes = (targetDate.getUTCMinutes() + 30) % 60;
    const timeInMinutes = istHours * 60 + istMinutes;

    // 555 mins = 09:15, 930 mins = 15:30
    if (
      timeInMinutes >= 555 &&
      timeInMinutes < 930 &&
      targetDate.getDay() !== 0 &&
      targetDate.getDay() !== 6
    ) {
      candles.push(getDeterministicCandle(symbol, targetDate, "5m"));
    }
  }

  return candles;
}
