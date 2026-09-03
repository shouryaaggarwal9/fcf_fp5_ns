"use client";

import React, { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  HistogramSeries,
  CandlestickData,
  HistogramData,
  Time,
} from "lightweight-charts";
import { HistoricalCandle, TimeFrame } from "../../lib/types/database";

interface TradingChartProps {
  candles: HistoricalCandle[];
  symbol: string;
  timeframe: TimeFrame;
  onTimeframeChange: (tf: TimeFrame) => void;
}

export const TradingChart: React.FC<TradingChartProps> = ({
  candles,
  symbol,
  timeframe,
  onTimeframeChange,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Initialize Chart Instance with dark-terminal palette
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0d1117" },
        textColor: "#8b949e",
      },
      grid: {
        vertLines: { color: "#161b22" },
        horzLines: { color: "#161b22" },
      },
      crosshair: {
        vertLine: { color: "#30363d", width: 1, style: 3 },
        horzLine: { color: "#30363d", width: 1, style: 3 },
      },
      timeScale: {
        borderColor: "#21262d",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: "#21262d",
      },
      handleScroll: true,
      handleScale: true,
    });

    // 2. Add Candlestick Series using v5 Series Definition
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    // 3. Add Volume Histogram Series using v5 Series Definition
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#26a69a",
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "", // Overlay over price pane
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // Volume occupies bottom 20%
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;

    // 4. Resize Observer for fluid container resizing
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });

    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  // Update Data when candles change
  useEffect(() => {
    if (
      !candlestickSeriesRef.current ||
      !volumeSeriesRef.current ||
      candles.length === 0
    ) {
      return;
    }

    const formattedCandles: CandlestickData<Time>[] = candles.map((c) => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000) as Time,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));

    const formattedVolume: HistogramData<Time>[] = candles.map((c) => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000) as Time,
      value: Number(c.volume),
      color:
        Number(c.close) >= Number(c.open)
          ? "rgba(34, 197, 94, 0.35)"
          : "rgba(239, 68, 68, 0.35)",
    }));

    candlestickSeriesRef.current.setData(formattedCandles);
    volumeSeriesRef.current.setData(formattedVolume);

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles]);

  return (
    <div className="flex flex-col w-full h-full bg-[#0d1117] border border-[#21262d] rounded-lg overflow-hidden">
      {/* Chart Control Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#21262d] bg-[#161b22]">
        <div className="flex items-center gap-3">
          <span className="font-bold text-sm tracking-wider text-slate-100">
            {symbol}
          </span>
          <span className="text-xs text-slate-400">NSE EQ</span>
        </div>

        {/* Timeframe Switcher */}
        <div className="flex items-center bg-[#0d1117] p-0.5 rounded border border-[#30363d]">
          <button
            type="button"
            onClick={() => onTimeframeChange("5m")}
            className={`px-3 py-1 text-xs font-semibold rounded transition ${
              timeframe === "5m"
                ? "bg-[#238636] text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            5m
          </button>
          <button
            type="button"
            onClick={() => onTimeframeChange("15m")}
            className={`px-3 py-1 text-xs font-semibold rounded transition ${
              timeframe === "15m"
                ? "bg-[#238636] text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            15m
          </button>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div ref={chartContainerRef} className="w-full h-130" />
    </div>
  );
};
