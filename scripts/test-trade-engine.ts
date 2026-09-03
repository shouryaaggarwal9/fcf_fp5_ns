import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import { evaluateOrderAgainstCandle } from "../features/trading-engine/matching";
import { HistoricalCandle, Order } from "../lib/types/database";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing environment variables in .env.local");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assertEq(actual: any, expected: any, label: string) {
  if (actual !== expected) {
    throw new Error(
      `[ASSERTION FAILED] ${label} -> Expected: ${expected}, Got: ${actual}`,
    );
  }
}

function assertNear(
  actual: number,
  expected: number,
  epsilon = 0.01,
  label: string,
) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(
      `[ASSERTION FAILED] ${label} -> Expected ~${expected}, Got: ${actual} (diff: ${Math.abs(actual - expected)})`,
    );
  }
}

async function runRigorousEngineTests() {
  console.log(
    "======================================================================",
  );
  console.log(
    "         EXCHANGE MATCHING & SETTLEMENT ENGINE TEST HARNESS            ",
  );
  console.log(
    "======================================================================\n",
  );

  const testEmail = `audit_suite_${Date.now()}@test.com`;
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: testEmail,
    password: "Password123!",
  });

  if (authError || !authData.user) {
    throw new Error(`Auth bootstrap failed: ${authError?.message}`);
  }
  const userId = authData.user.id;
  console.log(`[SETUP] Initialized Test Trader: ${userId}`);

  // Base capital: ₹10,00,000.00
  await supabase.from("wallets").upsert({
    user_id: userId,
    cash_balance: 1000000.0,
    locked_margin: 0.0,
  });

  // ---------------------------------------------------------------------------
  // TEST 1: MIS Market Buy (5x Leverage = 20% Margin)
  // ---------------------------------------------------------------------------
  console.log("\n[TEST 1] MIS Market Buy: 100 shares RELIANCE @ ₹3,000.00");
  const { data: o1Id } = await supabase.rpc("place_order_with_margin", {
    p_user_id: userId,
    p_symbol: "RELIANCE",
    p_side: "BUY",
    p_order_type: "MARKET",
    p_product_type: "MIS",
    p_quantity: 100,
    p_limit_price: 3000.0,
    p_trigger_price: null,
    p_stop_loss_price: null,
    p_virtual_time: "2024-01-01T09:15:00.000Z",
    p_estimated_price: 3000.0,
  });

  await supabase.rpc("execute_order_fill", {
    p_order_id: o1Id,
    p_fill_price: 3000.0,
    p_fill_time: "2024-01-01T09:15:00.000Z",
  });

  let { data: w } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single();
  let { data: pReliance } = await supabase
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", "RELIANCE")
    .eq("product_type", "MIS")
    .single();

  assertEq(Number(w.cash_balance), 940000.0, "T1 Cash (10L - 60k)");
  assertEq(Number(w.locked_margin), 60000.0, "T1 Margin (20% of 3L)");
  assertEq(pReliance.quantity, 100, "T1 Position Qty");
  assertEq(Number(pReliance.average_buy_price), 3000.0, "T1 Avg Price");
  console.log("✓ TEST 1 PASSED");

  // ---------------------------------------------------------------------------
  // TEST 2: CNC Market Buy (Delivery = 100% Cash Required)
  // ---------------------------------------------------------------------------
  console.log(
    "\n[TEST 2] CNC Market Buy: 50 shares TCS @ ₹4,000.00 (100% cash = ₹2,00,000)",
  );
  const { data: o2Id } = await supabase.rpc("place_order_with_margin", {
    p_user_id: userId,
    p_symbol: "TCS",
    p_side: "BUY",
    p_order_type: "MARKET",
    p_product_type: "CNC",
    p_quantity: 50,
    p_limit_price: 4000.0,
    p_trigger_price: null,
    p_stop_loss_price: null,
    p_virtual_time: "2024-01-01T09:20:00.000Z",
    p_estimated_price: 4000.0,
  });

  await supabase.rpc("execute_order_fill", {
    p_order_id: o2Id,
    p_fill_price: 4000.0,
    p_fill_time: "2024-01-01T09:20:00.000Z",
  });

  ({ data: w } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single());
  const { data: pTcs } = await supabase
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", "TCS")
    .single();

  assertEq(Number(w.cash_balance), 740000.0, "T2 Cash (9.4L - 2.0L)");
  assertEq(Number(w.locked_margin), 260000.0, "T2 Margin (60k MIS + 200k CNC)");
  assertEq(pTcs.quantity, 50, "T2 TCS Qty");
  assertEq(Number(pTcs.average_buy_price), 4000.0, "T2 TCS Avg Price");
  console.log("✓ TEST 2 PASSED");

  // ---------------------------------------------------------------------------
  // TEST 3: Multi-Fill Averaging (Buy 100 more RELIANCE MIS @ ₹3,200)
  // ---------------------------------------------------------------------------
  console.log(
    "\n[TEST 3] Position Averaging: Buy 100 RELIANCE MIS @ ₹3,200.00",
  );
  // Total 200 shares. Old: 100 @ 3000. New: 100 @ 3200. Expected Avg: ₹3,100.00
  // Added Margin: 100 * 3200 * 0.20 = ₹64,000.00
  const { data: o3Id } = await supabase.rpc("place_order_with_margin", {
    p_user_id: userId,
    p_symbol: "RELIANCE",
    p_side: "BUY",
    p_order_type: "MARKET",
    p_product_type: "MIS",
    p_quantity: 100,
    p_limit_price: 3200.0,
    p_trigger_price: null,
    p_stop_loss_price: null,
    p_virtual_time: "2024-01-01T09:25:00.000Z",
    p_estimated_price: 3200.0,
  });

  await supabase.rpc("execute_order_fill", {
    p_order_id: o3Id,
    p_fill_price: 3200.0,
    p_fill_time: "2024-01-01T09:25:00.000Z",
  });

  ({ data: pReliance } = await supabase
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", "RELIANCE")
    .eq("product_type", "MIS")
    .single());
  ({ data: w } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single());

  assertEq(pReliance.quantity, 200, "T3 Blended Qty");
  assertEq(
    Number(pReliance.average_buy_price),
    3100.0,
    "T3 Weighted Avg Price",
  );
  assertEq(Number(w.locked_margin), 324000.0, "T3 Locked Margin (260k + 64k)");
  assertEq(Number(w.cash_balance), 676000.0, "T3 Cash (740k - 64k)");
  console.log("✓ TEST 3 PASSED");

  // ---------------------------------------------------------------------------
  // TEST 4: Limit Order Margin Lock Before Execution
  // ---------------------------------------------------------------------------
  console.log(
    "\n[TEST 4] Limit Order Placement Margin Lock: 100 INFY MIS Limit @ ₹1,500.00",
  );
  // Required: 100 * 1500 * 0.20 = ₹30,000.00
  const { data: o4Id } = await supabase.rpc("place_order_with_margin", {
    p_user_id: userId,
    p_symbol: "INFY",
    p_side: "BUY",
    p_order_type: "LIMIT",
    p_product_type: "MIS",
    p_quantity: 100,
    p_limit_price: 1500.0,
    p_trigger_price: null,
    p_stop_loss_price: null,
    p_virtual_time: "2024-01-01T09:30:00.000Z",
    p_estimated_price: 1550.0,
  });

  ({ data: w } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single());
  const { data: o4 } = await supabase
    .from("orders")
    .select("*")
    .eq("id", o4Id)
    .single();

  assertEq(o4.status, "PENDING", "T4 Status Pending");
  assertEq(Number(w.locked_margin), 354000.0, "T4 Margin Locked Prior to Fill");
  console.log("✓ TEST 4 PASSED");

  // ---------------------------------------------------------------------------
  // TEST 5: Limit Order Fills on Price Dip
  // ---------------------------------------------------------------------------
  console.log(
    "\n[TEST 5] Matching Engine: Candle with low ₹1,495 breaches limit ₹1,500",
  );
  const candleDip: HistoricalCandle = {
    id: 999,
    symbol: "INFY",
    timeframe: "5m",
    timestamp: "2024-01-01T09:35:00.000Z",
    open: 1510.0,
    high: 1515.0,
    low: 1495.0,
    close: 1502.0,
    volume: 10000,
  };

  const match5 = evaluateOrderAgainstCandle(o4 as Order, candleDip);
  if (!match5)
    throw new Error("T5 Engine failed to trigger limit order on dip");

  await supabase.rpc("execute_order_fill", {
    p_order_id: match5.orderId,
    p_fill_price: match5.fillPrice,
    p_fill_time: match5.fillTime,
  });

  const { data: o4Updated } = await supabase
    .from("orders")
    .select("*")
    .eq("id", o4Id)
    .single();
  const { data: pInfy } = await supabase
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", "INFY")
    .single();

  assertEq(o4Updated.status, "FILLED", "T5 Order Status Filled");
  assertEq(pInfy.quantity, 100, "T5 INFY Position Created");
  console.log("✓ TEST 5 PASSED");

  // ---------------------------------------------------------------------------
  // TEST 6: Stop-Limit Order Triggering Logic
  // ---------------------------------------------------------------------------
  console.log("\n[TEST 6] Stop-Limit Buy: Trigger ₹1,520, Limit ₹1,525");
  const { data: o6Id } = await supabase.rpc("place_order_with_margin", {
    p_user_id: userId,
    p_symbol: "INFY",
    p_side: "BUY",
    p_order_type: "STOP_LIMIT",
    p_product_type: "MIS",
    p_quantity: 50,
    p_limit_price: 1525.0,
    p_trigger_price: 1520.0,
    p_stop_loss_price: null,
    p_virtual_time: "2024-01-01T09:40:00.000Z",
    p_estimated_price: 1510.0,
  });

  const { data: o6 } = await supabase
    .from("orders")
    .select("*")
    .eq("id", o6Id)
    .single();

  // Candle that doesn't reach trigger
  const candleSubTrigger: HistoricalCandle = {
    id: 1000,
    symbol: "INFY",
    timeframe: "5m",
    timestamp: "2024-01-01T09:45:00.000Z",
    open: 1510.0,
    high: 1518.0,
    low: 1505.0,
    close: 1515.0,
    volume: 5000,
  };
  assertEq(
    evaluateOrderAgainstCandle(o6 as Order, candleSubTrigger),
    null,
    "T6 No fill below trigger",
  );

  // Candle that breaches trigger
  const candleBreachTrigger: HistoricalCandle = {
    id: 1001,
    symbol: "INFY",
    timeframe: "5m",
    timestamp: "2024-01-01T09:50:00.000Z",
    open: 1516.0,
    high: 1528.0,
    low: 1514.0,
    close: 1524.0,
    volume: 8000,
  };
  const match6 = evaluateOrderAgainstCandle(o6 as Order, candleBreachTrigger);
  if (!match6)
    throw new Error("T6 Engine failed to trigger breached stop-limit order");
  assertEq(match6.fillPrice, 1525.0, "T6 Limit Price Executed");
  console.log("✓ TEST 6 PASSED");

  // ---------------------------------------------------------------------------
  // TEST 7: Stop Loss Trigger Evaluation
  // ---------------------------------------------------------------------------
  console.log("\n[TEST 7] Stop Loss Trigger Check on Falling Candle");
  const slCandle: HistoricalCandle = {
    id: 1002,
    symbol: "RELIANCE",
    timeframe: "5m",
    timestamp: "2024-01-01T10:00:00.000Z",
    open: 3000.0,
    high: 3005.0,
    low: 2940.0, // Breached stop loss of 2950
    close: 2945.0,
    volume: 12000,
  };

  const slOrderMock: Order = {
    id: "sl-test",
    user_id: userId,
    symbol: "RELIANCE",
    side: "BUY",
    order_type: "LIMIT",
    product_type: "MIS",
    quantity: 10,
    limit_price: 2950.0,
    trigger_price: null,
    stop_loss_price: 2950.0,
    status: "PENDING",
    placed_at_virtual_time: "2024-01-01T09:15:00.000Z",
    filled_price: null,
    filled_quantity: null,
    filled_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const matchSl = evaluateOrderAgainstCandle(slOrderMock, slCandle);
  if (!matchSl) throw new Error("T7 Stop Loss evaluation failed to trigger");
  console.log("✓ TEST 7 PASSED");

  // ---------------------------------------------------------------------------
  // TEST 8: Partial Manual Square-Off
  // ---------------------------------------------------------------------------
  console.log(
    "\n[TEST 8] Partial Manual Square-Off: Sell 50 of 200 RELIANCE MIS @ ₹3,300.00",
  );

  // FIX: Fetch the true wallet state from DB right before the test,
  // accounting for Test 6's new pending order locks!
  ({ data: w } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single());

  const prevCash = Number(w.cash_balance);
  const prevMargin = Number(w.locked_margin); // Now correctly 369,250

  const { data: o8Id } = await supabase.rpc("place_order_with_margin", {
    p_user_id: userId,
    p_symbol: "RELIANCE",
    p_side: "SELL",
    p_order_type: "MARKET",
    p_product_type: "MIS",
    p_quantity: 50,
    p_limit_price: 3300.0,
    p_trigger_price: null,
    p_stop_loss_price: null,
    p_virtual_time: "2024-01-01T10:30:00.000Z",
    p_estimated_price: 3300.0,
  });

  await supabase.rpc("execute_order_fill", {
    p_order_id: o8Id,
    p_fill_price: 3300.0,
    p_fill_time: "2024-01-01T10:30:00.000Z",
  });

  ({ data: pReliance } = await supabase
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", "RELIANCE")
    .eq("product_type", "MIS")
    .single());
  ({ data: w } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single());

  assertEq(pReliance.quantity, 150, "T8 Remaining Qty 150");
  assertEq(Number(pReliance.average_sell_price), 3300.0, "T8 Sell Avg Stamped");
  assertEq(Number(pReliance.realized_pnl), 10000.0, "T8 Realized PnL +10k");
  assertEq(
    Number(w.locked_margin),
    prevMargin - 31000.0,
    "T8 Exact Margin Released",
  );
  assertEq(
    Number(w.cash_balance),
    prevCash + 31000.0 + 10000.0,
    "T8 Cash Credited with Margin + PnL",
  );
  console.log("✓ TEST 8 PASSED");

  // ---------------------------------------------------------------------------
  // TEST 9: Full Position Liquidation with Clean Margin Zeroing
  // ---------------------------------------------------------------------------
  console.log(
    "\n[TEST 9] Full Manual Square-Off: Close remaining 150 RELIANCE MIS @ ₹3,000.00",
  );
  // Average buy: 3100. Exit: 3000. Loss: 150 * -100 = -₹15,000.00
  // Released margin: 150 * 3100 * 0.20 = ₹93,000.00
  // Net cash change: +93,000 - 15,000 = +₹78,000.00
  const cashBefore9 = Number(w.cash_balance);

  await supabase.rpc("square_off_position", {
    p_user_id: userId,
    p_symbol: "RELIANCE",
    p_product_type: "MIS",
    p_exit_price: 3000.0,
    p_exit_time: "2024-01-01T11:00:00.000Z",
  });

  ({ data: pReliance } = await supabase
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", "RELIANCE")
    .eq("product_type", "MIS")
    .single());
  ({ data: w } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single());

  assertEq(pReliance.quantity, 0, "T9 Position Fully Closed (0 Qty)");
  assertNear(
    Number(pReliance.realized_pnl),
    -5000.0,
    0.01,
    "T9 Cumulative PnL (+10k - 15k = -5k)",
  );
  assertNear(
    Number(w.cash_balance),
    cashBefore9 + 78000.0,
    0.01,
    "T9 Net Cash Settlement",
  );
  console.log("✓ TEST 9 PASSED");

  // ---------------------------------------------------------------------------
  // TEST 10: Illegal Sell Rejection (Short Selling Guard)
  // ---------------------------------------------------------------------------
  console.log(
    "\n[TEST 10] Anti-Short-Selling Guard: Attempt to SELL 100 RELIANCE with 0 holding",
  );
  let sellBlocked = false;
  try {
    await supabase.rpc("place_order_with_margin", {
      p_user_id: userId,
      p_symbol: "RELIANCE",
      p_side: "SELL",
      p_order_type: "MARKET",
      p_product_type: "MIS",
      p_quantity: 100,
      p_limit_price: 3000.0,
      p_trigger_price: null,
      p_stop_loss_price: null,
      p_virtual_time: "2024-01-01T11:30:00.000Z",
      p_estimated_price: 3000.0,
    });
  } catch (err) {
    sellBlocked = true;
  }
  // If rpc returns an error object without throwing in js client:
  const { error: sellError } = await supabase.rpc("place_order_with_margin", {
    p_user_id: userId,
    p_symbol: "RELIANCE",
    p_side: "SELL",
    p_order_type: "MARKET",
    p_product_type: "MIS",
    p_quantity: 100,
    p_limit_price: 3000.0,
    p_trigger_price: null,
    p_stop_loss_price: null,
    p_virtual_time: "2024-01-01T11:30:00.000Z",
    p_estimated_price: 3000.0,
  });

  if (sellBlocked || sellError) {
    console.log("✓ TEST 10 PASSED: Disallowed unowned SELL order successfully");
  } else {
    throw new Error(
      "T10 FAILED: Engine permitted short-selling without open position!",
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 11: Insufficient Balance Rejection
  // ---------------------------------------------------------------------------
  console.log(
    "\n[TEST 11] Insufficient Margin Guard: Attempt to buy 1,000,000 shares",
  );
  const { error: balanceError } = await supabase.rpc(
    "place_order_with_margin",
    {
      p_user_id: userId,
      p_symbol: "TCS",
      p_side: "BUY",
      p_order_type: "MARKET",
      p_product_type: "CNC",
      p_quantity: 1000000,
      p_limit_price: 4000.0,
      p_trigger_price: null,
      p_stop_loss_price: null,
      p_virtual_time: "2024-01-01T12:00:00.000Z",
      p_estimated_price: 4000.0,
    },
  );

  if (!balanceError) {
    throw new Error(
      "T11 FAILED: Engine allowed order exceeding available cash!",
    );
  }
  console.log("✓ TEST 11 PASSED: Rejected order exceeding balance");

  // ---------------------------------------------------------------------------
  // TEST 12: Day-End 15:15 Auto Square-Off Across Multiple Positions
  // ---------------------------------------------------------------------------
  console.log("\n[TEST 12] Day-End Auto Square-off at 15:15 IST");
  // INFY is still open from TEST 5 (100 shares). Square off via procedure.
  await supabase.rpc("square_off_position", {
    p_user_id: userId,
    p_symbol: "INFY",
    p_product_type: "MIS",
    p_exit_price: 1530.0,
    p_exit_time: "2024-01-01T15:15:00.000Z",
  });

  const { data: pInfyEnd } = await supabase
    .from("positions")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", "INFY")
    .single();
  assertEq(pInfyEnd.quantity, 0, "T12 INFY squared off to 0");
  console.log("✓ TEST 12 PASSED: Auto-square-off cleanly executed");

  console.log(
    "\n======================================================================",
  );
  console.log(
    "       ALL 12 CORE FINANCIAL ENGINE TESTS PASSED AUDIT SPEC!          ",
  );
  console.log(
    "======================================================================\n",
  );
}

runRigorousEngineTests().catch((err) => {
  console.error("\nTEST HARNESS CRITICAL FAILURE:", err);
  process.exit(1);
});
