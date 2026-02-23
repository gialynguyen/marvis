import type {
  Exchange,
  PriceTicker,
  Ticker24hr,
  BinancePriceResponse,
  BinanceTicker24hrResponse,
  BinanceWsTicker,
} from "./types";

const BINANCE_REST_BASE = "https://api.binance.com";
const BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws";

export class BinanceExchange implements Exchange {
  readonly name = "binance";
  private wsConnections: WebSocket[] = [];

  // ============= REST Methods =============

  async getPrice(symbol: string): Promise<PriceTicker> {
    const upperSymbol = symbol.toUpperCase();
    const url = `${BINANCE_REST_BASE}/api/v3/ticker/price?symbol=${upperSymbol}`;
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Binance API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as BinancePriceResponse;
    return {
      symbol: data.symbol,
      price: data.price,
      timestamp: Date.now(),
    };
  }

  async getPrices(symbols?: string[]): Promise<PriceTicker[]> {
    let url: string;

    if (symbols && symbols.length > 0) {
      const upperSymbols = symbols.map((s) => s.toUpperCase());
      const param = encodeURIComponent(JSON.stringify(upperSymbols));
      url = `${BINANCE_REST_BASE}/api/v3/ticker/price?symbols=${param}`;
    } else {
      url = `${BINANCE_REST_BASE}/api/v3/ticker/price`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Binance API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as BinancePriceResponse[];
    const now = Date.now();

    return data.map((item) => ({
      symbol: item.symbol,
      price: item.price,
      timestamp: now,
    }));
  }

  async get24hrStats(symbol: string): Promise<Ticker24hr> {
    const upperSymbol = symbol.toUpperCase();
    const url = `${BINANCE_REST_BASE}/api/v3/ticker/24hr?symbol=${upperSymbol}`;
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Binance API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as BinanceTicker24hrResponse;
    return this.mapTicker24hr(data);
  }

  async get24hrStatsAll(symbols?: string[]): Promise<Ticker24hr[]> {
    let url: string;

    if (symbols && symbols.length > 0) {
      const upperSymbols = symbols.map((s) => s.toUpperCase());
      const param = encodeURIComponent(JSON.stringify(upperSymbols));
      url = `${BINANCE_REST_BASE}/api/v3/ticker/24hr?symbols=${param}`;
    } else {
      url = `${BINANCE_REST_BASE}/api/v3/ticker/24hr`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Binance API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as BinanceTicker24hrResponse[];
    return data.map((item) => this.mapTicker24hr(item));
  }

  // ============= WebSocket Methods =============

  subscribePrice(
    symbols: string[],
    onUpdate: (ticker: PriceTicker) => void,
  ): () => void {
    const streams = symbols
      .map((s) => `${s.toLowerCase()}@miniTicker`)
      .join("/");
    const wsUrl = `${BINANCE_WS_BASE}/${streams}`;

    const ws = new WebSocket(wsUrl);

    ws.addEventListener("message", (event) => {
      try {
        const raw: BinanceWsTicker = JSON.parse(
          typeof event.data === "string" ? event.data : "",
        );
        onUpdate({
          symbol: raw.s,
          price: raw.c,
          timestamp: raw.E,
        });
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener("error", () => {
      // Silently handle WS errors — consumer can reconnect
    });

    this.wsConnections.push(ws);

    return () => {
      ws.close();
      this.wsConnections = this.wsConnections.filter((c) => c !== ws);
    };
  }

  // ============= Lifecycle =============

  destroy(): void {
    for (const ws of this.wsConnections) {
      ws.close();
    }
    this.wsConnections = [];
  }

  // ============= Private Helpers =============

  private mapTicker24hr(data: BinanceTicker24hrResponse): Ticker24hr {
    return {
      symbol: data.symbol,
      priceChange: data.priceChange,
      priceChangePercent: data.priceChangePercent,
      lastPrice: data.lastPrice,
      highPrice: data.highPrice,
      lowPrice: data.lowPrice,
      volume: data.volume,
      quoteVolume: data.quoteVolume,
      openTime: data.openTime,
      closeTime: data.closeTime,
    };
  }
}
