import { HistoricalCandle, TimeFrame } from "@/lib/types/database";
import { NSE_STOCKS } from "./constants";

export function generateHistoricalSession(
  symbol: string,
  startDateStr: string, // YYYY-MM-DD
  daysCount: number = 3,
): {
  candles5m: Omit<HistoricalCandle, "id">[];
  candles15m: Omit<HistoricalCandle, "id">[];
} {
  const meta = NSE_STOCKS[symbol];
  if (!meta) throw new Error(`Unknown symbol: ${symbol}`);

  const candles5m: Omit<HistoricalCandle, "id">[] = [];
  let currentPrice = meta.basePrice;

  const baseDate = new Date(startDateStr);

  for (let day = 0; day < daysCount; day++) {
    const sessionDate = new Date(baseDate);
    sessionDate.setDate(baseDate.getDate() + day);

    // Skip weekends
    if (sessionDate.getDay() === 0 || sessionDate.getDay() === 6) continue;

    // NSE Market Hours: 09:15 to 15:30 (75 five-minute bars per day)
    let hour = 9;
    let minute = 15;

    while (hour < 15 || (hour === 15 && minute <= 25)) {
      const timestamp = new Date(sessionDate);
      timestamp.setHours(hour, minute, 0, 0);

      // Deterministic fluctuation based on seed math
      const changePct =
        Math.sin(timestamp.getTime()) * 0.004 + (Math.random() - 0.495) * 0.003;
      const open = Math.round(currentPrice * 20) / 20;
      const close = Math.round(open * (1 + changePct) * 20) / 20;
      const high =
        Math.round(
          (Math.max(open, close) + Math.abs(open * 0.0015 * Math.random())) *
            20,
        ) / 20;
      const low =
        Math.round(
          (Math.min(open, close) - Math.abs(open * 0.0015 * Math.random())) *
            20,
        ) / 20;
      const volume = Math.floor(10000 + Math.random() * 50000);

      candles5m.push({
        symbol,
        timeframe: "5m",
        timestamp: timestamp.toISOString(),
        open,
        high,
        low,
        close,
        volume,
      });

      currentPrice = close;

      minute += 5;
      if (minute >= 60) {
        hour += 1;
        minute = 0;
      }
    }
  }

  // Aggregate 5m bars into 15m bars
  const candles15m: Omit<HistoricalCandle, "id">[] = [];
  for (let i = 0; i < candles5m.length; i += 3) {
    const group = candles5m.slice(i, i + 3);
    if (group.length === 0) continue;

    const first = group[0];
    const last = group[group.length - 1];
    const high = Math.max(...group.map((c) => c.high));
    const low = Math.min(...group.map((c) => c.low));
    const volume = group.reduce((sum, c) => sum + c.volume, 0);

    candles15m.push({
      symbol,
      timeframe: "15m",
      timestamp: first.timestamp,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    });
  }

  return { candles5m, candles15m };
}
