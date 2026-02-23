import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@marvis/core";
import type { Exchange } from "./exchanges/types";

// ============= Tool Parameter Types =============

export interface GetCryptoPriceParams {
  symbol: string;
}

export interface GetCryptoPricesParams {
  symbols?: string[];
}

export interface GetCryptoStatsParams {
  symbol: string;
}

// ============= Tool Result Detail Types =============

export interface CryptoPriceDetails {
  symbol: string;
  price: string;
  timestamp: string;
}

export interface CryptoPricesDetails {
  prices: Array<{ symbol: string; price: string }>;
}

export interface CryptoStatsDetails {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

// ============= Tool Factory =============

export function createTradingTools(exchange: Exchange): AgentTool[] {
  return [
    {
      name: "get_crypto_price",
      description:
        "Get the current price of a cryptocurrency trading pair from the exchange. Returns the symbol and its latest price.",
      dangerLevel: "safe",
      parameters: Type.Object({
        symbol: Type.String({
          description:
            'The trading pair symbol, e.g. "BTCUSDT", "ETHUSDT", "SOLUSDT"',
        }),
      }),
      execute: async (params: GetCryptoPriceParams) => {
        const ticker = await exchange.getPrice(params.symbol);
        const details: CryptoPriceDetails = {
          symbol: ticker.symbol,
          price: ticker.price,
          timestamp: new Date(ticker.timestamp).toISOString(),
        };
        return {
          content: [
            {
              type: "text" as const,
              text: `${ticker.symbol}: $${ticker.price}`,
            },
          ],
          details,
        };
      },
    } satisfies AgentTool<GetCryptoPriceParams, CryptoPriceDetails>,
    {
      name: "get_crypto_prices",
      description:
        "Get current prices for multiple cryptocurrency trading pairs. If no symbols are provided, returns a default watchlist (BTC, ETH, SOL, BNB, XRP).",
      dangerLevel: "safe",
      parameters: Type.Object({
        symbols: Type.Optional(
          Type.Array(Type.String(), {
            description:
              'Array of trading pair symbols, e.g. ["BTCUSDT", "ETHUSDT"]. Omit for default watchlist.',
          }),
        ),
      }),
      execute: async (params: GetCryptoPricesParams) => {
        const defaultSymbols = [
          "BTCUSDT",
          "ETHUSDT",
          "SOLUSDT",
          "BNBUSDT",
          "XRPUSDT",
        ];
        const targetSymbols =
          params.symbols && params.symbols.length > 0
            ? params.symbols
            : defaultSymbols;

        const tickers = await exchange.getPrices(targetSymbols);
        const prices = tickers.map((t) => ({
          symbol: t.symbol,
          price: t.price,
        }));

        const text = prices
          .map((p) => `${p.symbol}: $${p.price}`)
          .join("\n");

        return {
          content: [{ type: "text" as const, text }],
          details: { prices },
        };
      },
    } satisfies AgentTool<GetCryptoPricesParams, CryptoPricesDetails>,
    {
      name: "get_crypto_stats",
      description:
        "Get 24-hour price change statistics for a cryptocurrency trading pair. Includes price change, high, low, volume, and percentage change.",
      dangerLevel: "safe",
      parameters: Type.Object({
        symbol: Type.String({
          description:
            'The trading pair symbol, e.g. "BTCUSDT", "ETHUSDT"',
        }),
      }),
      execute: async (params: GetCryptoStatsParams) => {
        const stats = await exchange.get24hrStats(params.symbol);
        const details: CryptoStatsDetails = {
          symbol: stats.symbol,
          lastPrice: stats.lastPrice,
          priceChange: stats.priceChange,
          priceChangePercent: `${stats.priceChangePercent}%`,
          highPrice: stats.highPrice,
          lowPrice: stats.lowPrice,
          volume: stats.volume,
          quoteVolume: stats.quoteVolume,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `${stats.symbol} — Last: $${stats.lastPrice}, Change: ${stats.priceChange} (${stats.priceChangePercent}%), High: $${stats.highPrice}, Low: $${stats.lowPrice}, Vol: ${stats.volume}`,
            },
          ],
          details,
        };
      },
    } satisfies AgentTool<GetCryptoStatsParams, CryptoStatsDetails>,
  ];
}
