// app/page.tsx
import { TradingTerminal } from "@/features/terminal/TradingTerminal";

export const metadata = {
  title: "NSE Paper Trade Pro | Audit-Grade Simulator",
  description: "Zero-cost deterministic paper trading terminal",
};

export default function TradingTerminalPage() {
  return <TradingTerminal />;
}
