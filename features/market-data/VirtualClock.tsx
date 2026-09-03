"use client";

import React, { useEffect, useRef } from "react";
import { Play, Pause, StepForward, FastForward, Clock } from "lucide-react";

interface VirtualClockProps {
  currentVirtualTime: string;
  isPlaying: boolean;
  playbackSpeed: number;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onSpeedChange: (speed: number) => void;
}

export const VirtualClock: React.FC<VirtualClockProps> = ({
  currentVirtualTime,
  isPlaying,
  playbackSpeed,
  onTogglePlay,
  onStepForward,
  onSpeedChange,
}) => {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Drive simulation tick when playing
  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Interval inversely proportional to speed:
    // 1x = 3000ms per 5-min candle, 5x = 600ms, 10x = 300ms
    const intervalMs = Math.max(200, Math.floor(3000 / playbackSpeed));

    intervalRef.current = setInterval(() => {
      onStepForward();
    }, intervalMs);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, playbackSpeed, onStepForward]);

  const formattedDate = new Date(currentVirtualTime).toLocaleDateString(
    "en-IN",
    {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    },
  );

  const formattedTime = new Date(currentVirtualTime).toLocaleTimeString(
    "en-IN",
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    },
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2.5 bg-[#161b22] border border-[#21262d] rounded-lg text-slate-200">
      {/* Simulation Timestamp Display */}
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 rounded bg-[#0d1117] border border-[#30363d] text-emerald-400">
          <Clock className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white font-mono tracking-wide">
              {formattedTime} IST
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                isPlaying ? "bg-emerald-500 animate-pulse" : "bg-slate-500"
              }`}
            />
          </div>
          <span className="text-[11px] text-slate-400 font-medium">
            {formattedDate} (NSE Session)
          </span>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="flex items-center gap-2">
        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={onTogglePlay}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded transition ${
            isPlaying
              ? "bg-amber-600 hover:bg-amber-500 text-white"
              : "bg-emerald-600 hover:bg-emerald-500 text-white"
          }`}
        >
          {isPlaying ? (
            <Pause className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          <span>{isPlaying ? "Pause" : "Play"}</span>
        </button>

        {/* Step 1 Bar (+5m) */}
        <button
          type="button"
          onClick={onStepForward}
          disabled={isPlaying}
          title="Step next 5-min candle"
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-[#0d1117] hover:bg-[#21262d] disabled:opacity-40 disabled:cursor-not-allowed border border-[#30363d] text-slate-200 transition"
        >
          <StepForward className="w-3.5 h-3.5" />
          <span>+5m</span>
        </button>

        {/* Playback Speed Multipliers */}
        <div className="flex items-center bg-[#0d1117] p-0.5 rounded border border-[#30363d] text-xs">
          {[1, 5, 10].map((speed) => (
            <button
              key={speed}
              type="button"
              onClick={() => onSpeedChange(speed)}
              className={`px-2 py-1 rounded text-[11px] font-bold font-mono transition ${
                playbackSpeed === speed
                  ? "bg-[#21262d] text-white border border-slate-600"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
