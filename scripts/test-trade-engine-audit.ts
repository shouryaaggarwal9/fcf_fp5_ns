import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import { evaluateOrderAgainstCandle } from "../features/trading-engine/matching";
import { HistoricalCandle, Order } from "../lib/types/database";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Missing Supabase environment variables");

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[ASSERTION FAILED] ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string) {
  assert(
    actual === expected,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

function candle(overrides: Partial<HistoricalCandle>): HistoricalCandle {
  return {
    id: 1,
    symbol: "RELIANCE",
    timeframe: "5m",
    timestamp: "2024-01-01T09:20:00.000Z",
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000,
    ...overrides,
  };
}

function order(overrides: Partial<Order>): Order {
  return {
    id: "order-test",
    user_id: "user-test",
    symbol: "RELIANCE",
    side: "BUY",
    order_type: "LIMIT",
    product_type: "MIS",
    quantity: 10,
    limit_price: 100,
    trigger_price: null,
    stop_loss_price: 90,
    target_price: 110,
    status: "PENDING",
    filled_price: null,
    filled_quantity: null,
    filled_at: null,
    placed_at_virtual_time: "2024-01-01T09:15:00.000Z",
    created_at: "2024-01-01T09:15:00.000Z",
    updated_at: "2024-01-01T09:15:00.000Z",
    ...overrides,
  };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const result = await supabase.rpc(name, args);
  if (result.error) throw new Error(`${name}: ${result.error.message}`);
  return result.data;
}

async function expectRpcError(name: string, args: Record<string, unknown>) {
  const result = await supabase.rpc(name, args);
  assert(result.error, `${name} unexpectedly succeeded`);
  return result.error;
}

async function run() {
  console.log("TRADE ENGINE AUDIT SUITE");

  console.log("[PURE] Matching boundaries and directions");
  const buy = order({ side: "BUY", limit_price: 100 });
  equal(
    evaluateOrderAgainstCandle(
      buy,
      candle({ low: 100, timestamp: "2024-01-01T09:20:00.000Z" }),
    )?.fillPrice,
    100,
    "buy fills at exact limit",
  );
  equal(
    evaluateOrderAgainstCandle(
      buy,
      candle({ timestamp: "2024-01-01T09:14:59.000Z", low: 1 }),
    ),
    null,
    "order cannot fill before placement",
  );

  const sell = order({ side: "SELL", limit_price: 110 });
  equal(
    evaluateOrderAgainstCandle(sell, candle({ high: 109, low: 80 })),
    null,
    "sell limit does not fill on low alone",
  );
  equal(
    evaluateOrderAgainstCandle(sell, candle({ high: 110 }))?.fillPrice,
    110,
    "sell limit fills at exact high",
  );

  const stopSell = order({
    side: "SELL",
    order_type: "STOP_LIMIT",
    trigger_price: 90,
    limit_price: 90,
  });
  assert(
    evaluateOrderAgainstCandle(stopSell, candle({ low: 90, high: 100 })),
    "sell stop fills at exact trigger",
  );
  equal(
    evaluateOrderAgainstCandle(order({ status: "CANCELLED" }), candle({})),
    null,
    "canceled order never matches",
  );
  console.log("  PASS pure matcher edge cases");

  const email = `engine_audit_${Date.now()}@test.invalid`;
  let userId: string | undefined;
  try {
    if (process.env.SUPABASE_SECRET_KEY) {
      const created = await supabase.auth.admin.createUser({
        email,
        password: "AuditPassword123!",
        email_confirm: true,
      });
      if (created.error || !created.data.user) throw created.error;
      userId = created.data.user.id;
    } else {
      const created = await supabase.auth.signUp({
        email,
        password: "AuditPassword123!",
      });
      if (created.error || !created.data.user) throw created.error;
      userId = created.data.user.id;
    }
    assert(userId, "audit user was created");
    await supabase.from("wallets").upsert({
      user_id: userId,
      cash_balance: 100000,
      locked_margin: 0,
    });

    const base = {
      p_user_id: userId,
      p_symbol: "RELIANCE",
      p_product_type: "MIS",
      p_quantity: 10,
      p_virtual_time: "2024-01-01T09:15:00.000Z",
    };

    console.log("[DB] BUY with independent target and stop loss");
    const buyId = await rpc("place_order_with_margin", {
      ...base,
      p_side: "BUY",
      p_order_type: "MARKET",
      p_limit_price: 100,
      p_trigger_price: null,
      p_stop_loss_price: 90,
      p_target_price: 110,
      p_estimated_price: 100,
    });
    await rpc("execute_order_fill", {
      p_order_id: buyId,
      p_fill_price: 100,
      p_fill_time: base.p_virtual_time,
    });

    const { data: exits, error: exitsError } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .eq("symbol", "RELIANCE")
      .eq("side", "SELL");
    if (exitsError) throw exitsError;
    assert(exits?.length === 2, "both target and stop-loss exits were created");
    assert(
      exits.some(
        (item) =>
          item.order_type === "LIMIT" && Number(item.limit_price) === 110,
      ),
      "target exit is a LIMIT SELL at 110",
    );
    assert(
      exits.some(
        (item) =>
          item.order_type === "STOP_LIMIT" &&
          Number(item.trigger_price) === 90 &&
          Number(item.limit_price) === 90,
      ),
      "stop-loss exit is a STOP_LIMIT SELL at 90",
    );
    console.log("  PASS bracket creation and independent values");

    console.log("[DB] Manual SELL invalidates stale bracket exits");
    const manualSellId = await rpc("place_order_with_margin", {
      ...base,
      p_side: "SELL",
      p_order_type: "MARKET",
      p_limit_price: 105,
      p_trigger_price: null,
      p_stop_loss_price: null,
      p_target_price: null,
      p_estimated_price: 105,
    });
    await rpc("execute_order_fill", {
      p_order_id: manualSellId,
      p_fill_price: 105,
      p_fill_time: "2024-01-01T09:20:00.000Z",
    });

    const { data: position } = await supabase
      .from("positions")
      .select("quantity")
      .eq("user_id", userId)
      .eq("symbol", "RELIANCE")
      .eq("product_type", "MIS")
      .single();
    equal(Number(position?.quantity), 0, "manual sell closes the position");

    const { data: staleExits } = await supabase
      .from("orders")
      .select("status")
      .eq("user_id", userId)
      .eq("symbol", "RELIANCE")
      .eq("side", "SELL")
      .neq("id", manualSellId);
    assert(
      staleExits?.every((item) => item.status === "CANCELLED"),
      "all competing exits are canceled after manual square-off",
    );
    console.log("  PASS stale exit cancellation");

    console.log("[DB] Replay and anti-short protections");
    const staleExitId = exits?.[0]?.id;
    assert(staleExitId, "stale exit id exists");
    await rpc("execute_order_fill", {
      p_order_id: staleExitId,
      p_fill_price: 110,
      p_fill_time: "2024-01-01T09:25:00.000Z",
    });
    const { data: replayPosition } = await supabase
      .from("positions")
      .select("quantity")
      .eq("user_id", userId)
      .eq("symbol", "RELIANCE")
      .eq("product_type", "MIS")
      .single();
    equal(
      Number(replayPosition?.quantity),
      0,
      "canceled exit replay is harmless",
    );

    await expectRpcError("place_order_with_margin", {
      ...base,
      p_side: "SELL",
      p_order_type: "MARKET",
      p_limit_price: 100,
      p_trigger_price: null,
      p_stop_loss_price: null,
      p_target_price: null,
      p_estimated_price: 100,
    });
    console.log("  PASS canceled replay and naked SELL rejection");

    console.log("[DB] Competing pending SELL quantities cannot over-liquidate");
    await rpc("place_order_with_margin", {
      ...base,
      p_side: "BUY",
      p_order_type: "MARKET",
      p_limit_price: 100,
      p_trigger_price: null,
      p_stop_loss_price: null,
      p_target_price: null,
      p_estimated_price: 100,
    }).then((id) =>
      rpc("execute_order_fill", {
        p_order_id: id,
        p_fill_price: 100,
        p_fill_time: "2024-01-01T09:30:00.000Z",
      }),
    );
    const sellOne = await rpc("place_order_with_margin", {
      ...base,
      p_quantity: 6,
      p_side: "SELL",
      p_order_type: "LIMIT",
      p_limit_price: 105,
      p_trigger_price: null,
      p_stop_loss_price: null,
      p_target_price: null,
      p_estimated_price: 100,
    });
    const sellTwo = await rpc("place_order_with_margin", {
      ...base,
      p_quantity: 6,
      p_side: "SELL",
      p_order_type: "LIMIT",
      p_limit_price: 106,
      p_trigger_price: null,
      p_stop_loss_price: null,
      p_target_price: null,
      p_estimated_price: 100,
    });
    await rpc("execute_order_fill", {
      p_order_id: sellOne,
      p_fill_price: 105,
      p_fill_time: "2024-01-01T09:35:00.000Z",
    });
    const { data: competing } = await supabase
      .from("orders")
      .select("id,status")
      .in("id", [sellOne, sellTwo]);
    equal(
      competing?.find((item) => item.id === sellTwo)?.status,
      "CANCELLED",
      "oversized competing sell is canceled",
    );
    console.log("  PASS over-liquidation guard");

    console.log("ALL AUDIT TESTS PASSED");
  } finally {
    if (userId && process.env.SUPABASE_SECRET_KEY) {
      await supabase.auth.admin.deleteUser(userId);
    }
  }
}

run().catch((error) => {
  console.error("AUDIT FAILURE:", error);
  process.exit(1);
});
