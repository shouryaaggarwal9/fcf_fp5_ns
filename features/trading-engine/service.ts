import { createClient } from "../../lib/supabase/client";
import { PlaceOrderInput } from "@/lib/types/order-schames";
import { HistoricalCandle, Order } from "../../lib/types/database";
import { evaluateOrderAgainstCandle } from "./matching";

export class TradingService {
  private supabase = createClient();

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
        p_side: "BUY",
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

    if (error) throw new Error(error.message);

    if (input.orderType === "MARKET") {
      await this.executeFill(orderId, currentMarketPrice, input.virtualTime);
    }

    return orderId as string;
  }

  async squareOff(
    userId: string,
    symbol: string,
    productType: "MIS" | "CNC",
    exitPrice: number,
    exitTime: string,
  ) {
    const { data: orderId, error } = await this.supabase.rpc(
      "square_off_position",
      {
        p_user_id: userId,
        p_symbol: symbol,
        p_product_type: productType,
        p_exit_price: exitPrice,
        p_exit_time: exitTime,
      },
    );

    if (error) throw new Error(error.message);
    return orderId as string;
  }

  async executeFill(orderId: string, fillPrice: number, fillTime: string) {
    const { error } = await this.supabase.rpc("execute_order_fill", {
      p_order_id: orderId,
      p_fill_price: fillPrice,
      p_fill_time: fillTime,
    });

    if (error) throw new Error(error.message);
  }

  async reconcilePendingOrders(
    userId: string,
    elapsedCandles: HistoricalCandle[],
  ) {
    const { data: orders, error } = await this.supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["PENDING", "TRIGGER_PENDING"]);

    if (error || !orders || orders.length === 0) return;

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
          order.status = "FILLED";
        }
      }
    }
  }
}

export const tradingService = new TradingService();
