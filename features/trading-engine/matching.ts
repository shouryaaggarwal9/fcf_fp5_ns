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

  if (order.symbol !== candle.symbol) {
    return null;
  }

  const candleStartTime = new Date(candle.timestamp).getTime();
  const candleEndTime = candleStartTime + 5 * 60 * 1000; // 5-minute duration
  const orderTime = new Date(order.placed_at_virtual_time).getTime();

  // 1. Ignore if the candle completely closed BEFORE the order was placed
  if (candleEndTime <= orderTime) {
    return null;
  }

  const exactFillTime = new Date().toISOString();

  // 2. Intra-Candle Taint Protection
  // If the order was placed during this active candle, the candle's High/Low
  // includes price action from BEFORE the order existed. We must evaluate
  // strictly against the instantaneous live tick (candle.close).
  const isMidCandle = orderTime > candleStartTime;
  const evalHigh = isMidCandle ? candle.close : candle.high;
  const evalLow = isMidCandle ? candle.close : candle.low;

  // 3. LIMIT BUY / SELL (Target Exits)
  if (order.order_type === "LIMIT" && order.limit_price !== null) {
    const isMatched =
      order.side === "BUY"
        ? evalLow <= order.limit_price
        : evalHigh >= order.limit_price;

    if (isMatched) {
      // Execute exactly at the requested limit price to prevent slippage on targets
      const fillPrice = isMidCandle
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

  // 4. STOP_LIMIT BUY / SELL (Stop-Loss Exits)
  if (order.order_type === "STOP_LIMIT" && order.trigger_price !== null) {
    const isMatched =
      order.side === "BUY"
        ? evalHigh >= order.trigger_price
        : evalLow <= order.trigger_price;

    if (isMatched) {
      return {
        orderId: order.id,
        // Fallback to trigger price if limit is null (Stop-Market behavior)
        fillPrice: order.limit_price ?? order.trigger_price,
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

  const evalLow = candle.low; // GTTs are evaluated statically against historical catchup

  if (evalLow <= gtt.trigger_price) {
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
