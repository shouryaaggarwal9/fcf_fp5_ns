import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { NSE_STOCKS } from "../../features/market-data/constants";
import { generateHistoricalSession } from "../../features/market-data/generator";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !secretKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, secretKey);

async function seed() {
  console.log("Starting historical candle data seed for 10 NSE stocks...");
  const symbols = Object.keys(NSE_STOCKS);

  for (const symbol of symbols) {
    console.log(`Generating candles for ${symbol}...`);
    const { candles5m, candles15m } = generateHistoricalSession(
      symbol,
      "2024-01-01",
      5,
    );
    const allCandles = [...candles5m, ...candles15m];

    // Insert in batches of 200
    for (let i = 0; i < allCandles.length; i += 200) {
      const batch = allCandles.slice(i, i + 200);
      const { error } = await supabase
        .from("historical_candles")
        .upsert(batch, {
          onConflict: "symbol,timeframe,timestamp",
        });

      if (error) {
        console.error(`Error inserting batch for ${symbol}:`, error.message);
        process.exit(1);
      }
    }
    console.log(
      `Successfully seeded ${allCandles.length} candles for ${symbol}`,
    );
  }

  console.log("All 10 NSE stocks seeded successfully!");
}

seed();
