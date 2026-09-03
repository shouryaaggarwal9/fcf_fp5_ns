import { createClient } from "@/supabase/client";
import { PlaceOrderInput } from "@/lib/types/order-schames";
import { HistoricalCandle, Order } from "../../lib/types/database";
import { evaluateOrderAgainstCandle } from "./matching";

export class TradingService {
  private supabase = createClient();

  /**
   * Places an order and locks the required margin atomically
   */
  async placeOrder(
    userId: string,
    input: PlaceOrderInput,
    currentMarketPrice: number,
  ) {
    const { data: orderId, error } = await this.supabase.rpc(
      "place_order_with_margin",
      {
        p_user_id: userId,
        p_symbol: input.symbol,
        p_order_type: input.orderType,
        p_product_type: input.productType,
        p_quantity: input.quantity,
        p_limit_price: input.limitPrice ?? null,
        p_trigger_price: input.triggerPrice ?? null,
        p_stop_loss_price: input.stopLossPrice ?? null,
        p_virtual_time: input.virtualTime,
        p_estimated_price: currentMarketPrice,
      },
    );

    if (error) {
      throw new Error(`Order placement failed: ${error.message}`);
    }

    // If MARKET order, execute fill immediately at current price
    if (input.orderType === "MARKET") {
      await this.executeFill(orderId, currentMarketPrice, input.virtualTime);
    }

    return orderId as string;
  }

  /**
   * Executes fill via Postgres atomic stored procedure
   */
  async executeFill(orderId: string, fillPrice: number, fillTime: string) {
    const { error } = await this.supabase.rpc("execute_order_fill", {
      p_order_id: orderId,
      p_fill_price: fillPrice,
      p_fill_time: fillTime,
    });

    if (error) {
      throw new Error(`Fill execution failed: ${error.message}`);
    }
  }

  /**
   * Reconciles all pending orders across elapsed historical candles
   * (Crucial for offline / closed-tab simulation resumption)
   */
  async reconcilePendingOrders(
    userId: string,
    elapsedCandles: HistoricalCandle[],
  ) {
    // 1. Fetch user's pending orders
    const { data: orders, error } = await this.supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["PENDING", "TRIGGER_PENDING"]);

    if (error || !orders || orders.length === 0) return;

    // 2. Iterate chronologically through candles and evaluate matching
    for (const candle of elapsedCandles) {
      for (const order of orders as Order[]) {
        if (order.status === "FILLED") continue;

        const match = evaluateOrderAgainstCandle(order, candle);
        if (match) {
          await this.executeFill(
            match.orderId,
            match.fillPrice,
            match.fillTime,
          );
          order.status = "FILLED"; // Mark locally to prevent double execution in loop
        }
      }
    }
  }
}

export const tradingService = new TradingService();
