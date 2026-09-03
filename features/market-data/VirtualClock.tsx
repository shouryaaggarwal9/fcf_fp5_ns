"use client";

import React from "react";
import { Clock } from "lucide-react";

interface VirtualClockProps {
  currentVirtualTime: string;
}

export const VirtualClock: React.FC<VirtualClockProps> = ({
  currentVirtualTime,
}) => {
  const dateObj = new Date(currentVirtualTime);

  const timeString = dateObj.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata", // Displaying the mapped UTC time as our simulated IST
  });

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d1117] border border-[#21262d] rounded-md">
      <Clock className="w-4 h-4 text-emerald-500" />
      <div className="flex flex-col">
        <span className="text-sm font-bold font-mono tracking-wide text-slate-200">
          {timeString} IST
        </span>
        <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">
          NSE Live Session
        </span>
      </div>
    </div>
  );
};
