import { HistoricalCandle, Order, GttRule } from "@/lib/types/database";

export interface MatchResult {
  orderId: string;
  fillPrice: number;
  fillTime: string;
}

export interface GttTriggerResult {
  gttId: string;
  triggerTime: string;
  limitPrice: number;
  symbol: string;
  productType: "CNC" | "MIS";
  quantity: number;
}

/**
 * Checks whether an open order's price conditions were satisfied by a candle.
 */
export function evaluateOrderAgainstCandle(
  order: Order,
  candle: HistoricalCandle,
): MatchResult | null {
  if (order.status !== "PENDING" && order.status !== "TRIGGER_PENDING") {
    return null;
  }

  // Symbol must match
  if (order.symbol !== candle.symbol) {
    return null;
  }

  // FIX: Mid-Candle Time Paradox
  // A candle's timestamp marks its START. We must allow matching if the order
  // was placed at any point before the candle FINISHED.
  const candleStartTime = new Date(candle.timestamp).getTime();
  const candleEndTime = candleStartTime + 5 * 60 * 1000; // 5-minute duration
  const orderTime = new Date(order.placed_at_virtual_time).getTime();

  // Only ignore if the candle completely closed BEFORE the order was placed
  if (candleEndTime <= orderTime) {
    return null;
  }

  const exactFillTime = new Date().toISOString();

  // 1. LIMIT BUY / SELL (Target Exits)
  if (order.order_type === "LIMIT" && order.limit_price !== null) {
    const isMatched =
      order.side === "BUY"
        ? candle.low <= order.limit_price
        : candle.high >= order.limit_price;

    if (isMatched) {
      // If order placed mid-candle, execute exactly at the requested limit price
      const fillPrice =
        candleEndTime > orderTime && candleStartTime < orderTime
          ? order.limit_price
          : order.side === "BUY"
            ? Math.min(order.limit_price, candle.open)
            : Math.max(order.limit_price, candle.open);

      return {
        orderId: order.id,
        fillPrice: fillPrice,
        fillTime: exactFillTime,
      };
    }
  }

  // 2. STOP_LIMIT BUY / SELL (Stop-Loss Exits)
  if (
    order.order_type === "STOP_LIMIT" &&
    order.trigger_price !== null &&
    order.limit_price !== null
  ) {
    const isMatched =
      order.side === "BUY"
        ? candle.high >= order.trigger_price
        : candle.low <= order.trigger_price;

    if (isMatched) {
      return {
        orderId: order.id,
        fillPrice: order.limit_price,
        fillTime: exactFillTime,
      };
    }
  }

  return null;
}

/**
 * Evaluates GTT buy triggers against historical candle low/high
 */
export function evaluateGttAgainstCandle(
  gtt: GttRule,
  candle: HistoricalCandle,
): GttTriggerResult | null {
  if (gtt.status !== "ACTIVE" || gtt.symbol !== candle.symbol) {
    return null;
  }

  if (candle.low <= gtt.trigger_price) {
    return {
      gttId: gtt.id,
      triggerTime: new Date().toISOString(),
      limitPrice: gtt.limit_price,
      symbol: gtt.symbol,
      productType: gtt.product_type,
      quantity: gtt.quantity,
    };
  }

  return null;
}
