"use client";

import React from "react";
import { NSE_STOCKS } from "./constants";
import { TrendingUp, TrendingDown } from "lucide-react";

export interface StockQuote {
  symbol: string;
  currentPrice: number;
  openPrice: number;
  change: number;
  changePercent: number;
}

interface WatchlistProps {
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  quotes: Record<string, StockQuote>;
}

export const Watchlist: React.FC<WatchlistProps> = ({
  selectedSymbol,
  onSelectSymbol,
  quotes,
}) => {
  const stockKeys = Object.keys(NSE_STOCKS);

  return (
    <div className="flex flex-col w-full h-full bg-[#161b22] border border-[#21262d] rounded-lg overflow-hidden text-slate-200">
      {/* Watchlist Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#21262d] bg-[#0d1117]">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Market Watch (10 NSE)
        </h2>
        <span className="text-[11px] font-mono text-slate-500">Live Tick</span>
      </div>

      {/* Stock List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#21262d]/60">
        {stockKeys.map((symbol) => {
          const meta = NSE_STOCKS[symbol];
          const quote = quotes[symbol] || {
            symbol,
            currentPrice: meta.basePrice,
            openPrice: meta.basePrice,
            change: 0,
            changePercent: 0,
          };

          const isPositive = quote.change >= 0;
          const isSelected = selectedSymbol === symbol;

          return (
            <button
              key={symbol}
              type="button"
              onClick={() => onSelectSymbol(symbol)}
              className={`w-full flex items-center justify-between px-4 py-3 text-left transition ${
                isSelected
                  ? "bg-[#21262d] border-l-2 border-emerald-500"
                  : "hover:bg-[#1c2128]"
              }`}
            >
              {/* Symbol & Name */}
              <div className="flex flex-col min-w-0 pr-2">
                <span className="text-xs font-bold text-slate-100 truncate">
                  {symbol}
                </span>
                <span className="text-[10px] text-slate-400 truncate">
                  {meta.name}
                </span>
              </div>

              {/* Price & Change */}
              <div className="flex flex-col items-end shrink-0">
                <span className="text-xs font-mono font-semibold text-slate-100">
                  ₹{quote.currentPrice.toFixed(2)}
                </span>
                <div
                  className={`flex items-center gap-0.5 text-[10px] font-mono font-medium ${
                    isPositive ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {isPositive ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  <span>
                    {isPositive ? "+" : ""}
                    {quote.changePercent.toFixed(2)}%
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
