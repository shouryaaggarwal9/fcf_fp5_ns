"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        // If email confirmation is disabled in Supabase, session is active immediately
        if (data.session) {
          router.push("/");
          router.refresh();
        } else {
          setSuccessMsg(
            "Account created! Check your email to confirm or sign in directly if confirmation is off.",
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        router.push("/");
        router.refresh();
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Authentication failed. Please check your credentials.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0e14] px-4 font-sans text-slate-100">
      <div className="w-full max-w-105 rounded-xl border border-[#21262d] bg-[#161b22] p-8 shadow-2xl">
        {/* Header Branding */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 font-black text-white text-lg">
            N
          </div>
          <h1 className="text-xl font-bold tracking-wide uppercase text-white">
            NSE Paper Trade Pro
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Sign in to access your persistent portfolio and trade terminal
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="mb-6 flex rounded-lg border border-[#30363d] bg-[#0d1117] p-1">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${
              mode === "signin"
                ? "bg-[#21262d] text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${
              mode === "signup"
                ? "bg-[#21262d] text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-400">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="trader@example.com"
              className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3.5 py-2 font-mono text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-400">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3.5 py-2 font-mono text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {errorMsg && (
            <div className="rounded border border-rose-800 bg-rose-950/80 p-2.5 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="rounded border border-emerald-800 bg-emerald-950/80 p-2.5 text-xs text-emerald-300">
              {successMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded bg-emerald-600 py-2.5 text-sm font-bold tracking-wide text-white transition hover:bg-emerald-500 active:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Authenticating..."
              : mode === "signin"
                ? "Sign In to Terminal"
                : "Create Paper Trading Account"}
          </button>
        </form>

        <div className="mt-6 text-center text-[11px] text-slate-500">
          Demo virtual funds of ₹10,00,000 allocated automatically on signup.
        </div>
      </div>
    </div>
  );
}
