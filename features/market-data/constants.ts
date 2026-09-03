export interface StockMeta {
  symbol: string;
  name: string;
  basePrice: number;
  lotSize: number;
  tickSize: number;
}

export const NSE_STOCKS: Record<string, StockMeta> = {
  RELIANCE: {
    symbol: "RELIANCE",
    name: "Reliance Industries Ltd",
    basePrice: 2950.0,
    lotSize: 1,
    tickSize: 0.05,
  },
  TCS: {
    symbol: "TCS",
    name: "Tata Consultancy Services Ltd",
    basePrice: 4120.0,
    lotSize: 1,
    tickSize: 0.05,
  },
  HDFCBANK: {
    symbol: "HDFCBANK",
    name: "HDFC Bank Ltd",
    basePrice: 1680.0,
    lotSize: 1,
    tickSize: 0.05,
  },
  INFY: {
    symbol: "INFY",
    name: "Infosys Ltd",
    basePrice: 1850.0,
    lotSize: 1,
    tickSize: 0.05,
  },
  ICICIBANK: {
    symbol: "ICICIBANK",
    name: "ICICI Bank Ltd",
    basePrice: 1210.0,
    lotSize: 1,
    tickSize: 0.05,
  },
  SBIN: {
    symbol: "SBIN",
    name: "State Bank of India",
    basePrice: 830.0,
    lotSize: 1,
    tickSize: 0.05,
  },
  BHARTIARTL: {
    symbol: "BHARTIARTL",
    name: "Bharti Airtel Ltd",
    basePrice: 1540.0,
    lotSize: 1,
    tickSize: 0.05,
  },
  ITC: {
    symbol: "ITC",
    name: "ITC Ltd",
    basePrice: 495.0,
    lotSize: 1,
    tickSize: 0.05,
  },
  LT: {
    symbol: "LT",
    name: "Larsen & Toubro Ltd",
    basePrice: 3620.0,
    lotSize: 1,
    tickSize: 0.05,
  },
  KOTAKBANK: {
    symbol: "KOTAKBANK",
    name: "Kotak Mahindra Bank Ltd",
    basePrice: 1790.0,
    lotSize: 1,
    tickSize: 0.05,
  },
};

export const SUPPORTED_SYMBOLS = Object.keys(NSE_STOCKS);
