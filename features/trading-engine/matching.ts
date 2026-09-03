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

  // Candle must be at or after order placement
  if (new Date(candle.timestamp) < new Date(order.placed_at_virtual_time)) {
    return null;
  }

  // 1. LIMIT BUY: If candle dipped to or below the limit price
  if (order.order_type === "LIMIT" && order.limit_price !== null) {
    const isMatched =
      order.side === "BUY"
        ? candle.low <= order.limit_price
        : candle.high >= order.limit_price;
    if (isMatched) {
      const executionPrice =
        order.side === "BUY"
          ? Math.min(order.limit_price, candle.open)
          : Math.max(order.limit_price, candle.open);
      return {
        orderId: order.id,
        fillPrice: executionPrice,
        fillTime: candle.timestamp,
      };
    }
  }

  // 2. STOP_LIMIT BUY: Trigger condition checked first
  if (
    order.order_type === "STOP_LIMIT" &&
    order.trigger_price !== null &&
    order.limit_price !== null
  ) {
    const isMatched =
      order.side === "BUY"
        ? candle.high >= order.trigger_price && candle.low <= order.limit_price
        : candle.low <= order.trigger_price && candle.high >= order.limit_price;
    if (isMatched) {
      return {
        orderId: order.id,
        fillPrice: order.limit_price,
        fillTime: candle.timestamp,
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

  // Buy GTT triggers if price dips to or below trigger price
  if (candle.low <= gtt.trigger_price) {
    return {
      gttId: gtt.id,
      triggerTime: candle.timestamp,
      limitPrice: gtt.limit_price,
      symbol: gtt.symbol,
      productType: gtt.product_type,
      quantity: gtt.quantity,
    };
  }

  return null;
}
