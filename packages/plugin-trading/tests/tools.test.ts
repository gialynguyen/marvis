import { describe, it, expect, vi } from "vitest";
import { createTradingTools } from "../src/tools";
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

describe("createTradingTools", () => {
  describe("get_crypto_price", () => {
    it("should return price for a symbol", async () => {
      const exchange = createMockExchange();
      const mockTicker: PriceTicker = {
        symbol: "BTCUSDT",
        price: "95000.50",
        timestamp: 1700000000000,
      };
      vi.mocked(exchange.getPrice).mockResolvedValueOnce(mockTicker);

      const tools = createTradingTools(exchange);
      const priceTool = tools.find((t) => t.name === "get_crypto_price");
      expect(priceTool).toBeDefined();

      const result = await priceTool!.execute({ symbol: "BTCUSDT" });
      expect(result.content).toEqual([
        { type: "text", text: "BTCUSDT: $95000.50" },
      ]);
      expect(result.details).toEqual({
        symbol: "BTCUSDT",
        price: "95000.50",
        timestamp: expect.any(String),
      });
      expect(exchange.getPrice).toHaveBeenCalledWith("BTCUSDT");
    });
  });

  describe("get_crypto_prices", () => {
    it("should return prices for specified symbols", async () => {
      const exchange = createMockExchange();
      const mockTickers: PriceTicker[] = [
        { symbol: "BTCUSDT", price: "95000.50", timestamp: Date.now() },
        { symbol: "ETHUSDT", price: "3200.00", timestamp: Date.now() },
      ];
      vi.mocked(exchange.getPrices).mockResolvedValueOnce(mockTickers);

      const tools = createTradingTools(exchange);
      const pricesTool = tools.find((t) => t.name === "get_crypto_prices");

      const result = await pricesTool!.execute({
        symbols: ["BTCUSDT", "ETHUSDT"],
      });
      expect(result.content).toEqual([
        { type: "text", text: "BTCUSDT: $95000.50\nETHUSDT: $3200.00" },
      ]);
      expect(result.details).toEqual({
        prices: [
          { symbol: "BTCUSDT", price: "95000.50" },
          { symbol: "ETHUSDT", price: "3200.00" },
        ],
      });
      expect(exchange.getPrices).toHaveBeenCalledWith(["BTCUSDT", "ETHUSDT"]);
    });

    it("should use default symbols when none provided", async () => {
      const exchange = createMockExchange();
      vi.mocked(exchange.getPrices).mockResolvedValueOnce([]);

      const tools = createTradingTools(exchange);
      const pricesTool = tools.find((t) => t.name === "get_crypto_prices");

      await pricesTool!.execute({});
      expect(exchange.getPrices).toHaveBeenCalledWith([
        "BTCUSDT",
        "ETHUSDT",
        "SOLUSDT",
        "BNBUSDT",
        "XRPUSDT",
      ]);
    });
  });

  describe("get_crypto_stats", () => {
    it("should return 24hr stats for a symbol", async () => {
      const exchange = createMockExchange();
      const mockStats: Ticker24hr = {
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
      };
      vi.mocked(exchange.get24hrStats).mockResolvedValueOnce(mockStats);

      const tools = createTradingTools(exchange);
      const statsTool = tools.find((t) => t.name === "get_crypto_stats");

      const result = await statsTool!.execute({ symbol: "BTCUSDT" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.details).toEqual({
        symbol: "BTCUSDT",
        lastPrice: "95000.50",
        priceChange: "1500.00",
        priceChangePercent: "1.60%",
        highPrice: "96000.00",
        lowPrice: "93000.00",
        volume: "12345.678",
        quoteVolume: "1172839506.12",
      });
    });
  });

  it("should create exactly 3 tools", () => {
    const exchange = createMockExchange();
    const tools = createTradingTools(exchange);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "get_crypto_price",
      "get_crypto_prices",
      "get_crypto_stats",
    ]);
  });

  it("should mark all tools as safe", () => {
    const exchange = createMockExchange();
    const tools = createTradingTools(exchange);
    for (const tool of tools) {
      expect(tool.dangerLevel).toBe("safe");
    }
  });
});
