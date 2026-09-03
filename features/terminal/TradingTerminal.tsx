"use client";

import React from "react";
import { Watchlist } from "@/features/market-data/Watchlist";
import { TradingChart } from "@/features/charting/TradingChart";
import { OrderForm } from "@/features/trading-engine/OrderForm";
import { PortfolioPanel } from "@/features/portfolio/PortfolioPanel";
import { useTradingEngine } from "./useTradingEngine";
import { NSE_STOCKS } from "@/features/market-data/constants";

export function TradingTerminal() {
  const { state, actions } = useTradingEngine();

  const activeQuote = state.quotes[state.selectedSymbol];
  const currentPrice =
    state.activeBar?.close ??
    activeQuote?.currentPrice ??
    NSE_STOCKS[state.selectedSymbol]?.basePrice ??
    1000;

  const portfolioQuotes =
    state.activeBar && activeQuote
      ? {
          ...state.quotes,
          [state.selectedSymbol]: {
            ...activeQuote,
            currentPrice: state.activeBar.close,
          },
        }
      : state.quotes;

  if (!state.userId) {
    return <div className="min-h-screen bg-[#0b0e14]" />;
  }

  return (
    <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 max-w-400 mx-auto w-full items-start">
      <section className="lg:col-span-3 h-200">
        <Watchlist
          selectedSymbol={state.selectedSymbol}
          onSelectSymbol={actions.setSelectedSymbol}
          quotes={state.quotes}
        />
      </section>

      <section className="lg:col-span-6 flex flex-col gap-3">
        <div className="h-130">
          <TradingChart
            candles={state.candles}
            currentTick={state.activeBar}
            symbol={state.selectedSymbol}
            timeframe={state.timeframe}
            onTimeframeChange={actions.setTimeframe}
          />
        </div>
        <div className="w-full">
          <PortfolioPanel
            wallet={state.wallet}
            positions={state.positions}
            orders={state.orders}
            quotes={portfolioQuotes}
            onSquareOff={actions.handleSquareOff}
            onCancelOrder={actions.handleCancelOrder}
          />
        </div>
      </section>

      <section className="lg:col-span-3">
        <OrderForm
          symbol={state.selectedSymbol}
          currentMarketPrice={currentPrice}
          virtualTime={state.virtualTime}
          userId={state.userId}
          availableCash={state.wallet ? Number(state.wallet.cash_balance) : 0}
          positions={state.positions}
          onOrderPlaced={actions.fetchUserData}
        />
      </section>
    </main>
  );
}
