import React from "react";
import { Navbar } from "@/components/Navbar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen bg-[#0b0e14] text-slate-100 font-sans">
      <Navbar />
      {/* The children prop will render your Terminal, P&L, or Account pages */}
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  );
}
