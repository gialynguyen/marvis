import { Hono } from "hono";
import type { Exchange } from "../exchanges/types";

export interface ApiRoutesOptions {
  exchange: Exchange;
  defaultSymbols: string[];
}

export function createApiRoutes(options: ApiRoutesOptions): Hono {
  const { exchange, defaultSymbols } = options;
  const api = new Hono();

  // GET /api/config - Get dashboard configuration (default symbols, exchange name)
  api.get("/config", (c) => {
    return c.json({
      success: true,
      data: {
        exchange: exchange.name,
        defaultSymbols,
      },
    });
  });

  // GET /api/prices - Get prices (defaults to watchlist symbols)
  api.get("/prices", async (c) => {
    try {
      const symbolsParam = c.req.query("symbols");
      const symbols = symbolsParam
        ? symbolsParam.split(",").map((s) => s.trim().toUpperCase())
        : defaultSymbols;

      const tickers = await exchange.getPrices(symbols);
      return c.json({ success: true, data: tickers });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      return c.json({ success: false, error: message }, 500);
    }
  });

  // GET /api/prices/:symbol - Get price for a single symbol
  api.get("/prices/:symbol", async (c) => {
    try {
      const symbol = c.req.param("symbol").toUpperCase();
      const ticker = await exchange.getPrice(symbol);
      return c.json({ success: true, data: ticker });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      return c.json({ success: false, error: message }, 500);
    }
  });

  // GET /api/stats - Get 24hr stats (defaults to watchlist symbols)
  api.get("/stats", async (c) => {
    try {
      const symbolsParam = c.req.query("symbols");
      const symbols = symbolsParam
        ? symbolsParam.split(",").map((s) => s.trim().toUpperCase())
        : defaultSymbols;

      const stats = await exchange.get24hrStatsAll(symbols);
      return c.json({ success: true, data: stats });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      return c.json({ success: false, error: message }, 500);
    }
  });

  // GET /api/stats/:symbol - Get 24hr stats for a single symbol
  api.get("/stats/:symbol", async (c) => {
    try {
      const symbol = c.req.param("symbol").toUpperCase();
      const stats = await exchange.get24hrStats(symbol);
      return c.json({ success: true, data: stats });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      return c.json({ success: false, error: message }, 500);
    }
  });

  return api;
}
