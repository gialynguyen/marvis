import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createApiRoutes } from "../src/web/routes";
import type { Exchange, PriceTicker, Ticker24hr } from "../src/exchanges/types";

function createMockExchange(): Exchange {
  return {
    name: "mock",
    getPrice: vi.fn(),
    getPrices: vi.fn(),
    get24hrStats: vi.fn(),
    get24hrStatsAll: vi.fn(),
    subscribePrice: vi.fn(() => () => {}),
    destroy: vi.fn(),
  };
}

const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

function createTestApp(exchange: Exchange): Hono {
  const app = new Hono();
  const api = createApiRoutes({ exchange, defaultSymbols: DEFAULT_SYMBOLS });
  app.route("/api", api);
  return app;
}

describe("API Routes", () => {
  describe("GET /api/config", () => {
    it("should return exchange config with default symbols", async () => {
      const exchange = createMockExchange();
      const app = createTestApp(exchange);
      const res = await app.request("/api/config");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.exchange).toBe("mock");
      expect(body.data.defaultSymbols).toEqual(DEFAULT_SYMBOLS);
    });
  });

  describe("GET /api/prices", () => {
    it("should return prices for default symbols when no symbols specified", async () => {
      const exchange = createMockExchange();
      const mockTickers: PriceTicker[] = [
        { symbol: "BTCUSDT", price: "95000.50", timestamp: Date.now() },
        { symbol: "ETHUSDT", price: "3200.00", timestamp: Date.now() },
      ];
      vi.mocked(exchange.getPrices).mockResolvedValueOnce(mockTickers);

      const app = createTestApp(exchange);
      const res = await app.request("/api/prices");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(exchange.getPrices).toHaveBeenCalledWith(DEFAULT_SYMBOLS);
    });

    it("should filter by symbols query param", async () => {
      const exchange = createMockExchange();
      vi.mocked(exchange.getPrices).mockResolvedValueOnce([]);

      const app = createTestApp(exchange);
      await app.request("/api/prices?symbols=BTCUSDT,ETHUSDT");

      expect(exchange.getPrices).toHaveBeenCalledWith(["BTCUSDT", "ETHUSDT"]);
    });

    it("should return 500 on exchange error", async () => {
      const exchange = createMockExchange();
      vi.mocked(exchange.getPrices).mockRejectedValueOnce(
        new Error("API rate limited"),
      );

      const app = createTestApp(exchange);
      const res = await app.request("/api/prices");
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toBe("API rate limited");
    });
  });

  describe("GET /api/prices/:symbol", () => {
    it("should return price for a single symbol", async () => {
      const exchange = createMockExchange();
      const mockTicker: PriceTicker = {
        symbol: "BTCUSDT",
        price: "95000.50",
        timestamp: Date.now(),
      };
      vi.mocked(exchange.getPrice).mockResolvedValueOnce(mockTicker);

      const app = createTestApp(exchange);
      const res = await app.request("/api/prices/btcusdt");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.symbol).toBe("BTCUSDT");
      expect(exchange.getPrice).toHaveBeenCalledWith("BTCUSDT");
    });
  });

  describe("GET /api/stats", () => {
    it("should return 24hr stats for default symbols", async () => {
      const exchange = createMockExchange();
      const mockStats: Ticker24hr[] = [
        {
          symbol: "BTCUSDT",
          priceChange: "1500.00",
          priceChangePercent: "1.60",
          lastPrice: "95000.50",
          highPrice: "96000.00",
          lowPrice: "93000.00",
          volume: "12345.678",
          quoteVolume: "1172839506.12",
          openTime: 1700000000000,
          closeTime: 1700086400000,
        },
      ];
      vi.mocked(exchange.get24hrStatsAll).mockResolvedValueOnce(mockStats);

      const app = createTestApp(exchange);
      const res = await app.request("/api/stats");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].symbol).toBe("BTCUSDT");
      expect(exchange.get24hrStatsAll).toHaveBeenCalledWith(DEFAULT_SYMBOLS);
    });

    it("should filter by symbols query param", async () => {
      const exchange = createMockExchange();
      vi.mocked(exchange.get24hrStatsAll).mockResolvedValueOnce([]);

      const app = createTestApp(exchange);
      await app.request("/api/stats?symbols=BTCUSDT,ETHUSDT");

      expect(exchange.get24hrStatsAll).toHaveBeenCalledWith([
        "BTCUSDT",
        "ETHUSDT",
      ]);
    });
  });

  describe("GET /api/stats/:symbol", () => {
    it("should return 24hr stats for a single symbol", async () => {
      const exchange = createMockExchange();
      const mockStats: Ticker24hr = {
        symbol: "ETHUSDT",
        priceChange: "50.00",
        priceChangePercent: "1.59",
        lastPrice: "3200.00",
        highPrice: "3250.00",
        lowPrice: "3100.00",
        volume: "98765.432",
        quoteVolume: "316048382.40",
        openTime: 1700000000000,
        closeTime: 1700086400000,
      };
      vi.mocked(exchange.get24hrStats).mockResolvedValueOnce(mockStats);

      const app = createTestApp(exchange);
      const res = await app.request("/api/stats/ethusdt");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.symbol).toBe("ETHUSDT");
      expect(exchange.get24hrStats).toHaveBeenCalledWith("ETHUSDT");
    });
  });
});
