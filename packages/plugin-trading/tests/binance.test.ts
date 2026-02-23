import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BinanceExchange } from "../src/exchanges/binance";

describe("BinanceExchange", () => {
  let exchange: BinanceExchange;

  beforeEach(() => {
    exchange = new BinanceExchange();
  });

  afterEach(() => {
    exchange.destroy();
    vi.restoreAllMocks();
  });

  describe("getPrice", () => {
    it("should fetch price for a single symbol", async () => {
      const mockResponse = { symbol: "BTCUSDT", price: "95000.50" };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await exchange.getPrice("BTCUSDT");

      expect(result.symbol).toBe("BTCUSDT");
      expect(result.price).toBe("95000.50");
      expect(result.timestamp).toBeGreaterThan(0);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      );
    });

    it("should normalize symbol to uppercase", async () => {
      const mockResponse = { symbol: "ETHUSDT", price: "3200.00" };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      await exchange.getPrice("ethusdt");

      expect(fetch).toHaveBeenCalledWith(
        "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
      );
    });

    it("should throw on API error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), {
          status: 400,
        }),
      );

      await expect(exchange.getPrice("INVALID")).rejects.toThrow("Binance API error (400)");
    });
  });

  describe("getPrices", () => {
    it("should fetch prices for multiple symbols", async () => {
      const mockResponse = [
        { symbol: "BTCUSDT", price: "95000.50" },
        { symbol: "ETHUSDT", price: "3200.00" },
      ];

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await exchange.getPrices(["BTCUSDT", "ETHUSDT"]);

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe("BTCUSDT");
      expect(result[1].symbol).toBe("ETHUSDT");
    });

    it("should fetch all prices when no symbols provided", async () => {
      const mockResponse = [
        { symbol: "BTCUSDT", price: "95000.50" },
        { symbol: "ETHUSDT", price: "3200.00" },
        { symbol: "SOLUSDT", price: "180.00" },
      ];

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await exchange.getPrices();

      expect(result).toHaveLength(3);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.binance.com/api/v3/ticker/price",
      );
    });
  });

  describe("get24hrStats", () => {
    it("should fetch 24hr stats for a symbol", async () => {
      const mockResponse = {
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

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await exchange.get24hrStats("BTCUSDT");

      expect(result.symbol).toBe("BTCUSDT");
      expect(result.priceChange).toBe("1500.00");
      expect(result.priceChangePercent).toBe("1.60");
      expect(result.lastPrice).toBe("95000.50");
      expect(result.highPrice).toBe("96000.00");
      expect(result.lowPrice).toBe("93000.00");
      expect(result.volume).toBe("12345.678");
    });
  });

  describe("get24hrStatsAll", () => {
    it("should fetch 24hr stats for specified symbols", async () => {
      const mockResponse = [
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
        {
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
        },
      ];

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await exchange.get24hrStatsAll(["BTCUSDT", "ETHUSDT"]);

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe("BTCUSDT");
      expect(result[1].symbol).toBe("ETHUSDT");
    });
  });

  describe("name", () => {
    it("should return 'binance'", () => {
      expect(exchange.name).toBe("binance");
    });
  });
});
