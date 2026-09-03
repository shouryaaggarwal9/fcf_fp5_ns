"use client";

import React, { useState } from "react";
import { Order, Position, Wallet } from "../../lib/types/database";
import { StockQuote } from "../market-data/Watchlist";

interface PortfolioPanelProps {
  wallet: Wallet | null;
  positions: Position[];
  orders: Order[];
  quotes: Record<string, StockQuote>;
}

export const PortfolioPanel: React.FC<PortfolioPanelProps> = ({
  wallet,
  positions,
  orders,
  quotes,
}) => {
  const [activeTab, setActiveTab] = useState<"positions" | "orders">(
    "positions",
  );

  const openPositions = positions.filter((p) => p.quantity > 0);
  const closedPositions = positions.filter(
    (p) => p.quantity === 0 && Number(p.realized_pnl) !== 0,
  );

  let totalUnrealizedPnl = 0;
  const openPositionsWithPnl = openPositions.map((pos) => {
    const currentPrice =
      quotes[pos.symbol]?.currentPrice ?? pos.average_buy_price;
    const pnl = (currentPrice - pos.average_buy_price) * pos.quantity;
    const pnlPercent =
      ((currentPrice - pos.average_buy_price) / pos.average_buy_price) * 100;
    totalUnrealizedPnl += pnl;

    return {
      ...pos,
      currentPrice,
      pnl,
      pnlPercent,
    };
  });

  const totalRealizedPnl = positions.reduce(
    (acc, p) => acc + Number(p.realized_pnl || 0),
    0,
  );
  const cash = wallet ? Number(wallet.cash_balance) : 0;
  const margin = wallet ? Number(wallet.locked_margin) : 0;
  const totalAccountValue = cash + margin + totalUnrealizedPnl;

  return (
    <div className="flex flex-col w-full bg-[#161b22] border border-[#21262d] rounded-lg overflow-hidden text-slate-200">
      {/* Financial Ledger Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 border-b border-[#21262d] bg-[#0d1117] text-xs">
        <div className="flex flex-col">
          <span className="text-slate-400">Cash Available</span>
          <span className="text-sm font-bold font-mono text-white">
            ₹{cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-slate-400">Locked Margin</span>
          <span className="text-sm font-bold font-mono text-amber-400">
            ₹{margin.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-slate-400">Realized P&L</span>
          <span
            className={`text-sm font-bold font-mono ${
              totalRealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {totalRealizedPnl >= 0 ? "+" : ""}₹{totalRealizedPnl.toFixed(2)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-slate-400">Unrealized P&L</span>
          <span
            className={`text-sm font-bold font-mono ${
              totalUnrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {totalUnrealizedPnl >= 0 ? "+" : ""}₹{totalUnrealizedPnl.toFixed(2)}
          </span>
        </div>
        <div className="flex flex-col col-span-2 md:col-span-1">
          <span className="text-slate-400">Total Portfolio Value</span>
          <span className="text-sm font-bold font-mono text-emerald-400">
            ₹
            {totalAccountValue.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
            })}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#21262d] bg-[#161b22] px-4">
        <button
          type="button"
          onClick={() => setActiveTab("positions")}
          className={`py-2.5 px-4 text-xs font-bold border-b-2 transition ${
            activeTab === "positions"
              ? "border-blue-500 text-white"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Positions ({openPositions.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("orders")}
          className={`py-2.5 px-4 text-xs font-bold border-b-2 transition ${
            activeTab === "orders"
              ? "border-blue-500 text-white"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Orders ({orders.length})
        </button>
      </div>

      {/* Tables Area */}
      <div className="p-4 overflow-x-auto">
        {activeTab === "positions" ? (
          <div className="flex flex-col gap-6">
            {/* 1. Open Positions */}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Open Positions ({openPositionsWithPnl.length})
              </div>
              {openPositionsWithPnl.length === 0 ? (
                <div className="py-4 text-xs text-slate-500 italic">
                  No active open positions.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#21262d] text-slate-400 font-semibold">
                      <th className="pb-2">Instrument</th>
                      <th className="pb-2">Product</th>
                      <th className="pb-2 text-right">Qty</th>
                      <th className="pb-2 text-right">Avg Price</th>
                      <th className="pb-2 text-right">LTP</th>
                      <th className="pb-2 text-right">P&L (₹)</th>
                      <th className="pb-2 text-right">P&L (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#21262d]/60 font-mono">
                    {openPositionsWithPnl.map((p) => (
                      <tr key={p.id} className="hover:bg-[#1c2128]">
                        <td className="py-2.5 font-bold text-white">
                          {p.symbol}
                        </td>
                        <td className="py-2.5">
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-300">
                            {p.product_type}
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-bold text-emerald-400">
                          {p.quantity}
                        </td>
                        <td className="py-2.5 text-right">
                          ₹{Number(p.average_buy_price).toFixed(2)}
                        </td>
                        <td className="py-2.5 text-right">
                          ₹{p.currentPrice.toFixed(2)}
                        </td>
                        <td
                          className={`py-2.5 text-right font-semibold ${
                            p.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {p.pnl >= 0 ? "+" : ""}₹{p.pnl.toFixed(2)}
                        </td>
                        <td
                          className={`py-2.5 text-right font-semibold ${
                            p.pnlPercent >= 0
                              ? "text-emerald-400"
                              : "text-rose-400"
                          }`}
                        >
                          {p.pnlPercent >= 0 ? "+" : ""}
                          {p.pnlPercent.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 2. Closed Positions */}
            {closedPositions.length > 0 && (
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Closed Positions (Auto Squared-off / Exited)
                </div>
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#21262d] text-slate-400 font-semibold">
                      <th className="pb-2">Instrument</th>
                      <th className="pb-2">Product</th>
                      <th className="pb-2 text-right">Entry Avg</th>
                      <th className="pb-2 text-right">Realized P&L</th>
                      <th className="pb-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#21262d]/60 font-mono">
                    {closedPositions.map((p) => {
                      const realized = Number(p.realized_pnl);
                      return (
                        <tr key={p.id} className="hover:bg-[#1c2128]">
                          <td className="py-2 font-bold text-slate-300">
                            {p.symbol}
                          </td>
                          <td className="py-2">
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-400">
                              {p.product_type}
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            ₹{Number(p.average_buy_price).toFixed(2)}
                          </td>
                          <td
                            className={`py-2 text-right font-semibold ${
                              realized >= 0
                                ? "text-emerald-400"
                                : "text-rose-400"
                            }`}
                          >
                            {realized >= 0 ? "+" : ""}₹{realized.toFixed(2)}
                          </td>
                          <td className="py-2 text-right">
                            <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-slate-800 text-slate-400">
                              CLOSED
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          /* Orders Table with explicit BUY / SELL side */
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#21262d] text-slate-400 font-semibold">
                <th className="pb-2">Time</th>
                <th className="pb-2">Side</th>
                <th className="pb-2">Instrument</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Product</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Price</th>
                <th className="pb-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#21262d]/60 font-mono">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-[#1c2128]">
                  <td className="py-2.5 text-slate-400 text-[11px]">
                    {new Date(o.placed_at_virtual_time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                        o.side === "SELL"
                          ? "bg-rose-950 text-rose-400 border border-rose-800"
                          : "bg-emerald-950 text-emerald-400 border border-emerald-800"
                      }`}
                    >
                      {o.side || "BUY"}
                    </span>
                  </td>
                  <td className="py-2.5 font-bold text-white">{o.symbol}</td>
                  <td className="py-2.5 text-slate-300">{o.order_type}</td>
                  <td className="py-2.5">
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-300">
                      {o.product_type}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">{o.quantity}</td>
                  <td className="py-2.5 text-right">
                    {o.filled_price
                      ? `₹${Number(o.filled_price).toFixed(2)}`
                      : o.limit_price
                        ? `₹${Number(o.limit_price).toFixed(2)}`
                        : "MKT"}
                  </td>
                  <td className="py-2.5 text-right">
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                        o.status === "FILLED"
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                          : o.status === "PENDING"
                            ? "bg-amber-950 text-amber-400 border border-amber-800"
                            : "bg-rose-950 text-rose-400 border border-rose-800"
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
