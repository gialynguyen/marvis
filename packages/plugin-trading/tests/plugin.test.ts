import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TradingPlugin } from "../src/plugin";
import { TradingWebServer } from "../src/web/server";
import { exec } from "node:child_process";

// Mock the web server
vi.mock("../src/web/server", () => {
  return {
    TradingWebServer: vi.fn().mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getPort: vi.fn().mockReturnValue(3456),
    })),
  };
});

// Mock child_process.exec (for browser opening)
vi.mock("node:child_process", () => ({
  exec: vi.fn((_cmd: string, cb?: (error: Error | null) => void) => {
    if (cb) cb(null);
  }),
}));

describe("TradingPlugin", () => {
  let plugin: TradingPlugin;

  beforeEach(async () => {
    vi.clearAllMocks();
    plugin = new TradingPlugin();
    await plugin.initialize({
      exchange: "binance",
      webPort: 3456,
      defaultSymbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    });
  });

  afterEach(async () => {
    await plugin.shutdown();
  });

  it("should include open_trading_dashboard in getTools", () => {
    const tools = plugin.getTools();
    const dashboardTool = tools.find((t) => t.name === "open_trading_dashboard");
    expect(dashboardTool).toBeDefined();
    expect(dashboardTool!.dangerLevel).toBe("moderate");
  });

  it("should include all 4 tools", () => {
    const tools = plugin.getTools();
    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name)).toEqual([
      "get_crypto_price",
      "get_crypto_prices",
      "get_crypto_stats",
      "open_trading_dashboard",
    ]);
  });

  describe("open_trading_dashboard tool", () => {
    it("should start the web server and open browser", async () => {
      const tools = plugin.getTools();
      const dashboardTool = tools.find((t) => t.name === "open_trading_dashboard")!;

      const result = await dashboardTool.execute({});

      // Verify web server was created and started
      expect(TradingWebServer).toHaveBeenCalledWith({
        exchange: expect.any(Object),
        port: 3456,
        defaultSymbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
      });

      const mockServerInstance = vi.mocked(TradingWebServer).mock.results[0].value;
      expect(mockServerInstance.start).toHaveBeenCalled();

      // Verify browser was opened
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining("http://localhost:3456"),
        expect.any(Function),
      );

      // Verify the response
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain("http://localhost:3456");
      expect(result.content[0].text).toContain("BTCUSDT");
      expect(result.details).toEqual({
        url: "http://localhost:3456",
        port: 3456,
        symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
        exchange: "binance",
      });
    });

    it("should reuse existing server on subsequent calls", async () => {
      const tools = plugin.getTools();
      const dashboardTool = tools.find((t) => t.name === "open_trading_dashboard")!;

      await dashboardTool.execute({});
      await dashboardTool.execute({});

      // Server should only be created once
      expect(TradingWebServer).toHaveBeenCalledTimes(1);

      // But browser should be opened both times
      expect(exec).toHaveBeenCalledTimes(2);
    });

    it("should stop web server on plugin shutdown", async () => {
      const tools = plugin.getTools();
      const dashboardTool = tools.find((t) => t.name === "open_trading_dashboard")!;

      await dashboardTool.execute({});

      const mockServerInstance = vi.mocked(TradingWebServer).mock.results[0].value;
      await plugin.shutdown();

      expect(mockServerInstance.stop).toHaveBeenCalled();
    });
  });

  it("should mention open_trading_dashboard in system prompt", () => {
    const fragment = plugin.getSystemPromptFragment();
    expect(fragment).toContain("open_trading_dashboard");
  });
});
