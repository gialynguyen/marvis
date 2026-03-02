import {
  BasePlugin,
  type PluginManifest,
  type PluginConfigDescriptor,
} from "@marvis/core";
import type { AgentTool } from "@marvis/core";
import { Type } from "@sinclair/typebox";
import { BinanceExchange } from "./exchanges/binance";
import type { Exchange } from "./exchanges/types";
import { createTradingTools } from "./tools";
import { TradingWebServer } from "./web";
import { exec } from "node:child_process";

export type TradingPluginConfig = {
  exchange?: string;
  webPort?: number;
  defaultSymbols?: string[];
};

const DEFAULT_TRADING_CONFIG: TradingPluginConfig = {
  exchange: "binance",
  webPort: 3456,
  defaultSymbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
};

export class TradingPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "trading",
    name: "Trading",
    version: "1.0.0",
    description: "Crypto price tracking and market data from exchanges",
    capabilities: ["crypto_price", "market_data", "web_dashboard"],
  };

  configDescriptor: PluginConfigDescriptor<TradingPluginConfig> = {
    schema: Type.Object({
      exchange: Type.Optional(
        Type.String({
          description: "Exchange to connect to (supported: binance)",
        }),
      ),
      webPort: Type.Optional(
        Type.Number({
          description: "Port for the trading web dashboard",
        }),
      ),
      defaultSymbols: Type.Optional(
        Type.Array(
          Type.String({
            description:
              "Default trading pairs to track. There are my favorite coins :)",
          }),
        ),
      ),
    }),
    defaults: DEFAULT_TRADING_CONFIG,
  };

  private exchange!: Exchange;
  private tradingConfig!: TradingPluginConfig;
  private webServer: TradingWebServer | null = null;

  protected async onInitialize(): Promise<void> {
    // Config is already merged with defaults by BasePlugin.initialize()
    this.tradingConfig = this.config as TradingPluginConfig;

    // Initialize exchange client
    this.exchange = this.createExchange(
      this.tradingConfig.exchange || "binance",
    );

    this.logger.info(
      `Trading plugin initialized with ${this.exchange.name} exchange`,
    );
  }

  protected async onShutdown(): Promise<void> {
    if (this.webServer) {
      await this.webServer.stop();
      this.webServer = null;
    }
    this.exchange.destroy();
    this.logger.info("Trading plugin shut down");
  }

  getTools() {
    return [
      ...createTradingTools(this.exchange),
      this.createOpenDashboardTool(),
    ];
  }

  getSystemPromptFragment(): string {
    return `## Crypto Trading
You can retrieve real-time cryptocurrency price data from ${this.exchange.name}.
- Use \`get_crypto_price\` to get the current price of a specific trading pair (e.g., BTCUSDT)
- Use \`get_crypto_prices\` to get prices for multiple pairs at once
- Use \`get_crypto_stats\` to get 24-hour statistics including price change, high, low, and volume
- Use \`open_trading_dashboard\` to start the live trading web dashboard and open it in the user's browser
- Trading pairs are formatted as BASE+QUOTE (e.g., BTCUSDT = Bitcoin priced in USDT)
- Always retrieve the default symbols watchlist from current config
`;
  }

  /** Expose the exchange instance for use by web server and CLI */
  getExchange(): Exchange {
    return this.exchange;
  }

  /** Get the resolved plugin config */
  getTradingConfig(): TradingPluginConfig {
    return this.tradingConfig;
  }

  private createOpenDashboardTool(): AgentTool {
    return {
      name: "open_trading_dashboard",
      description:
        "Start the live trading web dashboard and open it in the user's default browser. " +
        "The dashboard shows real-time cryptocurrency prices with WebSocket streaming. " +
        "If the dashboard is already running, it simply opens the browser to the existing URL.",
      dangerLevel: "moderate",
      parameters: Type.Object({}),
      execute: async () => {
        const port = this.tradingConfig.webPort ?? 3456;
        const symbols = this.tradingConfig.defaultSymbols ?? [
          "BTCUSDT",
          "ETHUSDT",
          "SOLUSDT",
          "BNBUSDT",
          "XRPUSDT",
        ];
        const url = `http://localhost:${port}`;

        // Start the web server if it's not already running
        if (!this.webServer) {
          this.webServer = new TradingWebServer({
            exchange: this.exchange,
            port,
            defaultSymbols: symbols,
          });
          await this.webServer.start();
          this.logger.info(`Trading dashboard started on ${url}`);
        }

        // Open the browser
        openBrowser(url);

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Trading dashboard is running at ${url}\n` +
                `Symbols: ${symbols.join(", ")}\n` +
                `Exchange: ${this.exchange.name}\n\n` +
                `The dashboard has been opened in the default browser.`,
            },
          ],
          details: {
            url,
            port,
            symbols,
            exchange: this.exchange.name,
          },
        };
      },
    };
  }

  private createExchange(name: string): Exchange {
    switch (name) {
      case "binance":
        return new BinanceExchange();
      default:
        throw new Error(`Unsupported exchange: ${name}. Supported: binance`);
    }
  }
}

/**
 * Open a URL in the user's default browser.
 * Uses platform-specific commands: `open` (macOS), `xdg-open` (Linux), `start` (Windows).
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;

  switch (platform) {
    case "darwin":
      command = `open "${url}"`;
      break;
    case "win32":
      command = `start "" "${url}"`;
      break;
    default:
      // Linux and other Unix-like systems
      command = `xdg-open "${url}"`;
      break;
  }

  exec(command, (error) => {
    if (error) {
      // Non-fatal: the dashboard is still running even if the browser can't be opened
      console.error(`Failed to open browser: ${error.message}`);
    }
  });
}
