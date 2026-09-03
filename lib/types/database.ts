export type OrderType = "MARKET" | "LIMIT" | "STOP_LIMIT";
export type ProductType = "CNC" | "MIS"; // CNC = Delivery (100% margin), MIS = Intraday (leverage/auto-square-off)

export type OrderStatus =
  | "PENDING"
  | "TRIGGER_PENDING"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED";
export type GttStatus = "ACTIVE" | "TRIGGERED" | "CANCELLED" | "EXPIRED";
export type TimeFrame = "5m" | "15m";

export interface Wallet {
  id: string;
  user_id: string;
  cash_balance: number;
  locked_margin: number;
  created_at: string;
  updated_at: string;
}

export interface HistoricalCandle {
  id: number;
  symbol: string;
  timeframe: TimeFrame;
  timestamp: string; // ISO String
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Order {
  id: string;
  user_id: string;
  symbol: string;
  order_type: OrderType;
  product_type: ProductType;
  side: "BUY" | "SELL";
  quantity: number;
  limit_price: number | null;
  trigger_price: number | null;
  stop_loss_price: number | null;
  status: OrderStatus;
  filled_price: number | null;
  filled_quantity: number | null;
  filled_at: string | null;
  placed_at_virtual_time: string;
  created_at: string;
  updated_at: string;
}

export interface GttRule {
  id: string;
  user_id: string;
  symbol: string;
  product_type: ProductType;
  quantity: number;
  trigger_price: number;
  limit_price: number;
  status: GttStatus;
  triggered_at: string | null;
  created_at: string;
}

export interface Position {
  id: string;
  user_id: string;
  symbol: string;
  product_type: ProductType;
  quantity: number;
  average_buy_price: number;
  realized_pnl: number;
  created_at: string;
  updated_at: string;
}

export interface SimulationState {
  user_id: string;
  current_virtual_time: string;
  is_playing: boolean;
  playback_speed: number;
  updated_at: string;
}
