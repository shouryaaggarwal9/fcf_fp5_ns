"use client";

import React, { useState } from "react";
import { ProductType, OrderType } from "@/lib/types/database";
import { PlaceOrderSchema } from "@/lib/types/order-schames";
import { tradingService } from "./service";

interface OrderFormProps {
  symbol: string;
  currentMarketPrice: number;
  virtualTime: string;
  userId: string;
  availableCash: number;
  onOrderPlaced?: () => void;
}

export const OrderForm: React.FC<OrderFormProps> = ({
  symbol,
  currentMarketPrice,
  virtualTime,
  userId,
  availableCash,
  onOrderPlaced,
}) => {
  const [productType, setProductType] = useState<ProductType>("MIS");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [quantity, setQuantity] = useState<number>(1);
  const [limitPrice, setLimitPrice] = useState<string>(
    currentMarketPrice.toString(),
  );
  const [triggerPrice, setTriggerPrice] = useState<string>("");
  const [stopLossPrice, setStopLossPrice] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Margin calculation: MIS = 20% (0.20), CNC = 100% (1.00)
  const marginMultiplier = productType === "MIS" ? 0.2 : 1.0;
  const benchmarkPrice =
    orderType === "LIMIT" && Number(limitPrice) > 0
      ? Number(limitPrice)
      : currentMarketPrice;
  const estimatedMargin =
    Math.round(benchmarkPrice * quantity * marginMultiplier * 100) / 100;
  const hasSufficientFunds = availableCash >= estimatedMargin;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const inputData = {
      symbol,
      productType,
      orderType,
      quantity: Number(quantity),
      limitPrice: orderType !== "MARKET" ? Number(limitPrice) : null,
      triggerPrice: orderType === "STOP_LIMIT" ? Number(triggerPrice) : null,
      stopLossPrice: stopLossPrice ? Number(stopLossPrice) : null,
      virtualTime,
    };

    // 1. Zod Audit Validation
    const validation = PlaceOrderSchema.safeParse(inputData);
    if (!validation.success) {
      setErrorMsg(validation.error.issues[0]?.message || "Validation error");
      return;
    }

    if (!hasSufficientFunds) {
      setErrorMsg(
        `Insufficient funds: Requires ₹${estimatedMargin.toFixed(2)}`,
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await tradingService.placeOrder(
        userId,
        validation.data,
        currentMarketPrice,
      );
      if (onOrderPlaced) onOrderPlaced();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Failed to execute order");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col w-full bg-[#161b22] border border-[#21262d] rounded-lg p-4 text-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#21262d] pb-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-white tracking-wide">
            Place Order
          </h2>
          <span className="text-xs text-slate-400 font-mono">
            {symbol} @ ₹{currentMarketPrice.toFixed(2)}
          </span>
        </div>
        <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
          BUY ONLY
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Product Type (MIS vs CNC) */}
        <div className="flex gap-2 p-1 bg-[#0d1117] rounded border border-[#30363d]">
          <button
            type="button"
            onClick={() => setProductType("MIS")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded transition ${
              productType === "MIS"
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Intraday (MIS 5x)
          </button>
          <button
            type="button"
            onClick={() => setProductType("CNC")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded transition ${
              productType === "CNC"
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Delivery (CNC)
          </button>
        </div>

        {/* Order Type (MARKET / LIMIT / STOP_LIMIT) */}
        <div className="flex gap-1 bg-[#0d1117] p-1 rounded border border-[#30363d]">
          {(["MARKET", "LIMIT", "STOP_LIMIT"] as OrderType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setOrderType(type)}
              className={`flex-1 py-1 text-[11px] font-semibold rounded transition ${
                orderType === type
                  ? "bg-[#21262d] text-white border border-slate-600"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {type === "STOP_LIMIT" ? "SL-LMT" : type}
            </button>
          ))}
        </div>

        {/* Quantity */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-400">
            Quantity (Shares)
          </label>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) =>
              setQuantity(Math.max(1, parseInt(e.target.value) || 1))
            }
            className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>

        {/* Limit Price Input */}
        {orderType !== "MARKET" && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-400">
              Limit Price (₹)
            </label>
            <input
              type="number"
              step="0.05"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
        )}

        {/* Trigger Price for STOP_LIMIT */}
        {orderType === "STOP_LIMIT" && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-400">
              Trigger Price (₹)
            </label>
            <input
              type="number"
              step="0.05"
              value={triggerPrice}
              onChange={(e) => setTriggerPrice(e.target.value)}
              placeholder="e.g. 2960.00"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
        )}

        {/* Optional Stop Loss */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-400">
            Stop Loss Price (₹){" "}
            <span className="text-slate-500">(Optional)</span>
          </label>
          <input
            type="number"
            step="0.05"
            value={stopLossPrice}
            onChange={(e) => setStopLossPrice(e.target.value)}
            placeholder="Exit trigger price"
            className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>

        {/* Margin Audit Breakdown with Leverage Transparency */}
        <div className="flex flex-col gap-1.5 p-3 rounded bg-[#0d1117] border border-[#21262d] text-xs">
          <div className="flex justify-between text-slate-400">
            <span>Total Contract Value:</span>
            <span className="font-mono text-slate-300">
              ₹
              {(benchmarkPrice * quantity).toLocaleString("en-IN", {
                minimumFractionDigits: 2,
              })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">
              Margin Required (
              {productType === "MIS" ? "20% with 5x leverage" : "100% Delivery"}
              ):
            </span>
            <span className="font-mono font-semibold text-white">
              ₹
              {estimatedMargin.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
              })}
            </span>
          </div>
          <div className="flex justify-between border-t border-[#21262d] pt-1.5">
            <span className="text-slate-400">Available Cash:</span>
            <span
              className={`font-mono font-semibold ${
                hasSufficientFunds ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              ₹
              {availableCash.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="p-2 rounded bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
            {errorMsg}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting || !hasSufficientFunds}
          className="w-full py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm tracking-wide transition shadow-lg shadow-emerald-950"
        >
          {isSubmitting ? "Executing..." : `BUY ${symbol}`}
        </button>
      </form>
    </div>
  );
};
