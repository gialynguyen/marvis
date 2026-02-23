// ============= Price Ticker =============

export interface PriceTicker {
  /** Trading pair symbol, e.g. "BTCUSDT" */
  symbol: string;
  /** Current price as string to preserve precision */
  price: string;
  /** Timestamp in milliseconds */
  timestamp: number;
}

// ============= 24hr Statistics =============

export interface Ticker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
}

// ============= Exchange Interface =============

export interface Exchange {
  /** Exchange name identifier */
  readonly name: string;

  /** Get current price for a single symbol */
  getPrice(symbol: string): Promise<PriceTicker>;

  /** Get current prices for multiple symbols (all if omitted) */
  getPrices(symbols?: string[]): Promise<PriceTicker[]>;

  /** Get 24hr statistics for a single symbol */
  get24hrStats(symbol: string): Promise<Ticker24hr>;

  /** Get 24hr statistics for all symbols */
  get24hrStatsAll(symbols?: string[]): Promise<Ticker24hr[]>;

  /**
   * Subscribe to real-time price updates via WebSocket.
   * Returns an unsubscribe function.
   */
  subscribePrice(
    symbols: string[],
    onUpdate: (ticker: PriceTicker) => void,
  ): () => void;

  /** Clean up resources (close WebSocket connections, etc.) */
  destroy(): void;
}

// ============= Binance-specific raw API types =============

export interface BinancePriceResponse {
  symbol: string;
  price: string;
}

export interface BinanceTicker24hrResponse {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
}

export interface BinanceWsTicker {
  /** Event type */
  e: string;
  /** Event time */
  E: number;
  /** Symbol */
  s: string;
  /** Last price */
  c: string;
}
