import { Command } from "commander";
import { BinanceExchange, TradingWebServer, type TradingPluginConfig } from "@marvis/plugin-trading";
import { loadConfig, ensureConfigExists, PluginConfigRegistry } from "@marvis/config";
import { TradingPlugin } from "@marvis/plugin-trading";
import { ShellPlugin } from "@marvis/plugin-shell";

/**
 * Load trading plugin config from the Marvis config file (~/.marvis/config.toml).
 * This ensures CLI commands respect user-configured values for exchange, port, symbols, etc.
 */
function loadTradingConfig(): TradingPluginConfig {
  ensureConfigExists();
  const registry = new PluginConfigRegistry();

  // Register plugin schemas so config loading can resolve plugin defaults
  const tradingPlugin = new TradingPlugin();
  const shellPlugin = new ShellPlugin();
  for (const plugin of [shellPlugin, tradingPlugin]) {
    if (plugin.configDescriptor) {
      registry.register({
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        schema: plugin.configDescriptor.schema,
        defaults: plugin.configDescriptor.defaults,
        descriptions: plugin.configDescriptor.descriptions,
      });
    }
  }

  const config = loadConfig(undefined, registry);
  return (config.plugins.trading ?? {}) as TradingPluginConfig;
}

export function createTradingCommand(): Command {
  const trading = new Command("trading");
  trading.description("Crypto trading tools — price lookup and live dashboard");

  // marvis trading price <symbol>
  trading
    .command("price <symbol>")
    .description("Get current price of a crypto trading pair (e.g., BTCUSDT)")
    .action(async (symbol: string) => {
      const exchange = new BinanceExchange();
      try {
        const ticker = await exchange.getPrice(symbol);
        console.log(`${ticker.symbol}: $${formatPrice(ticker.price)}`);
      } catch (error) {
        console.error(
          "Error:",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      } finally {
        exchange.destroy();
      }
    });

  // marvis trading prices [symbols...]
  trading
    .command("prices [symbols...]")
    .description(
      "Get prices for multiple crypto pairs (defaults: BTC, ETH, SOL, BNB, XRP)",
    )
    .action(async (symbols: string[]) => {
      const exchange = new BinanceExchange();
      try {
        const tradingConfig = loadTradingConfig();
        const targetSymbols =
          symbols.length > 0
            ? symbols.map((s) => s.toUpperCase())
            : tradingConfig.defaultSymbols ?? ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

        const tickers = await exchange.getPrices(targetSymbols);

        // Print as a formatted table
        const maxSymbolLen = Math.max(
          ...tickers.map((t) => t.symbol.length),
          6,
        );
        console.log(
          `${"Symbol".padEnd(maxSymbolLen)}  ${"Price".padStart(16)}`,
        );
        console.log(`${"─".repeat(maxSymbolLen)}  ${"─".repeat(16)}`);

        for (const ticker of tickers) {
          console.log(
            `${ticker.symbol.padEnd(maxSymbolLen)}  ${`$${formatPrice(ticker.price).padStart(15)}`}`,
          );
        }
      } catch (error) {
        console.error(
          "Error:",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      } finally {
        exchange.destroy();
      }
    });

  // marvis trading stats <symbol>
  trading
    .command("stats <symbol>")
    .description("Get 24h statistics for a crypto trading pair")
    .action(async (symbol: string) => {
      const exchange = new BinanceExchange();
      try {
        const stats = await exchange.get24hrStats(symbol);
        const changeNum = Number.parseFloat(stats.priceChangePercent);
        const sign = changeNum >= 0 ? "+" : "";
        const changeStr = `${sign}${changeNum.toFixed(2)}%`;

        console.log(`${stats.symbol} — 24h Statistics`);
        console.log(`  Last Price:  $${formatPrice(stats.lastPrice)}`);
        console.log(`  Change:      ${stats.priceChange} (${changeStr})`);
        console.log(`  High:        $${formatPrice(stats.highPrice)}`);
        console.log(`  Low:         $${formatPrice(stats.lowPrice)}`);
        console.log(`  Volume:      ${formatVolume(stats.volume)}`);
      } catch (error) {
        console.error(
          "Error:",
          error instanceof Error ? error.message : error,
        );
        process.exit(1);
      } finally {
        exchange.destroy();
      }
    });

  // marvis trading watch
  trading
    .command("watch")
    .description("Start the live trading dashboard (web view)")
    .option("-p, --port <port>", "Port number")
    .option(
      "-s, --symbols <symbols>",
      "Comma-separated symbols to watch",
    )
    .action(async (options: { port?: string; symbols?: string }) => {
      const tradingConfig = loadTradingConfig();

      const port = options.port
        ? Number.parseInt(options.port, 10)
        : tradingConfig.webPort ?? 3456;
      const symbols = options.symbols
        ? options.symbols.split(",").map((s) => s.trim().toUpperCase())
        : tradingConfig.defaultSymbols ?? ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

      const exchange = new BinanceExchange();
      const server = new TradingWebServer({
        exchange,
        port,
        defaultSymbols: symbols,
      });

      try {
        await server.start();
        console.log("\n  🚀 Marvis Trading Dashboard");
        console.log("  ──────────────────────────");
        console.log(`  Local:    http://localhost:${port}`);
        console.log(`  Symbols:  ${symbols.join(", ")}`);
        console.log("  Exchange: Binance");
        console.log("\n  Press Ctrl+C to stop\n");

        // Handle graceful shutdown
        const shutdown = async () => {
          console.log("\n  Stopping dashboard...");
          await server.stop();
          exchange.destroy();
          process.exit(0);
        };

        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      } catch (error) {
        console.error(
          "Failed to start dashboard:",
          error instanceof Error ? error.message : error,
        );
        exchange.destroy();
        process.exit(1);
      }
    });

  return trading;
}

// ============= Formatting helpers =============

function formatPrice(price: string): string {
  const num = Number.parseFloat(price);
  if (num >= 1000)
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (num >= 1)
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 8,
  });
}

function formatVolume(volume: string): string {
  const num = Number.parseFloat(volume);
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}
