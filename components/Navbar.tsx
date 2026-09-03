"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VirtualClock } from "@/features/market-data/VirtualClock";

export function Navbar() {
  const router = useRouter();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState<string>("Loading...");
  const [virtualTime, setVirtualTime] = useState<string>("");

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setUserEmail(user.email || "Trader");
    }
    loadUser();

    // Independent lightweight tick for the clock
    setVirtualTime(new Date().toISOString());
    const interval = setInterval(() => {
      setVirtualTime(new Date().toISOString());
    }, 1000);

    return () => clearInterval(interval);
  }, [supabase]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-[#21262d] bg-[#161b22]">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded bg-emerald-600 flex items-center justify-center font-black text-white text-sm">
          N
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-wider uppercase text-white">
            NSE Paper Trade Pro
          </h1>
          <span className="text-[10px] text-slate-400 font-mono">
            Audit Grade • Zero Cost Architecture
          </span>
        </div>
      </div>

      <div className="w-auto">
        {virtualTime && <VirtualClock currentVirtualTime={virtualTime} />}
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden sm:flex flex-col text-right">
          <span className="text-xs font-semibold text-slate-200">
            {userEmail}
          </span>
          <span className="text-[10px] font-mono text-emerald-400">
            Authenticated Trader
          </span>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          title="Sign Out"
          className="flex items-center gap-1 px-3 py-1.5 rounded border border-[#30363d] bg-[#0d1117] hover:bg-[#21262d] text-slate-300 hover:text-white text-xs font-medium transition"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </header>
  );
}
