import { existsSync, readFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve, type ServerType } from "@hono/node-server";
import type { Exchange, PriceTicker } from "../exchanges/types";
import { createApiRoutes } from "./routes";
import type { WSContext } from "hono/ws";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve the static assets directory (works from both src/ and dist/) */
function resolveStaticDir(): string {
  // When running from dist/web/server.js → static is at dist/web/static/
  const distStatic = join(__dirname, "static");
  if (existsSync(distStatic)) return distStatic;

  // When running from src/web/server.ts (dev via tsx) → static is at src/web/static/
  const srcStatic = join(__dirname, "static");
  if (existsSync(srcStatic)) return srcStatic;

  // Fallback: CWD-relative
  const cwdStatic = join(process.cwd(), "src", "web", "static");
  if (existsSync(cwdStatic)) return cwdStatic;

  throw new Error(
    `Could not locate static assets directory. Tried:\n  - ${distStatic}\n  - ${cwdStatic}`,
  );
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface TradingWebServerOptions {
  exchange: Exchange;
  port: number;
  defaultSymbols: string[];
}

export class TradingWebServer {
  private app: Hono;
  private server: ServerType | null = null;
  private exchange: Exchange;
  private port: number;
  private defaultSymbols: string[];
  private wsClients: Set<WSContext> = new Set();
  private unsubscribeBinance: (() => void) | null = null;
  private injectWebSocket: ((server: ServerType) => void) | null = null;

  constructor(options: TradingWebServerOptions) {
    this.exchange = options.exchange;
    this.port = options.port;
    this.defaultSymbols = options.defaultSymbols;

    this.app = new Hono();

    const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({
      app: this.app,
    });

    // Store for server-level injection after listen
    this.injectWebSocket = injectWebSocket;

    // WebSocket endpoint for real-time price streaming
    this.app.get(
      "/ws",
      upgradeWebSocket(() => ({
        onOpen: (_event, ws) => {
          this.wsClients.add(ws);
        },
        onClose: (_event, ws) => {
          this.wsClients.delete(ws);
        },
      })),
    );

    // Mount API routes
    const apiRoutes = createApiRoutes({
      exchange: this.exchange,
      defaultSymbols: this.defaultSymbols,
    });
    this.app.route("/api", apiRoutes);

    // Resolve static directory once at construction time
    const staticDir = resolveStaticDir();

    // Serve static files and fall back to index.html for root
    this.app.get("/*", (c) => {
      const reqPath = c.req.path;
      // Determine which file to serve
      const fileName = reqPath === "/" ? "index.html" : reqPath.slice(1);
      const filePath = join(staticDir, fileName);

      if (!existsSync(filePath)) {
        // For root or unknown paths, try index.html
        const indexPath = join(staticDir, "index.html");
        if (existsSync(indexPath)) {
          return c.html(readFileSync(indexPath, "utf-8"));
        }
        return c.text("Not found", 404);
      }

      const ext = extname(filePath);
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";
      const content = readFileSync(filePath);

      return c.body(content, 200, {
        "Content-Type": mimeType,
        "Cache-Control": "no-cache",
      });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve(
        {
          fetch: this.app.fetch,
          port: this.port,
        },
        () => {
          // Inject WebSocket support into the server
          if (this.injectWebSocket && this.server) {
            this.injectWebSocket(this.server);
          }

          // Start subscribing to Binance WebSocket for real-time updates
          this.startBinanceStream();

          resolve();
        },
      );
    });
  }

  async stop(): Promise<void> {
    // Stop Binance WebSocket subscription
    if (this.unsubscribeBinance) {
      this.unsubscribeBinance();
      this.unsubscribeBinance = null;
    }

    // Close all client WebSocket connections
    for (const ws of this.wsClients) {
      try {
        ws.close();
      } catch {
        // Ignore errors on close
      }
    }
    this.wsClients.clear();

    // Stop HTTP server
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private startBinanceStream(): void {
    this.unsubscribeBinance = this.exchange.subscribePrice(
      this.defaultSymbols,
      (ticker: PriceTicker) => {
        this.broadcastToClients(ticker);
      },
    );
  }

  private broadcastToClients(ticker: PriceTicker): void {
    const message = JSON.stringify({
      type: "price_update",
      data: ticker,
    });

    for (const ws of this.wsClients) {
      try {
        ws.send(message);
      } catch {
        // Remove dead connections
        this.wsClients.delete(ws);
      }
    }
  }

  getPort(): number {
    return this.port;
  }
}
