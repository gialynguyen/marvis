import { createServer, Server, Socket } from "net";
import { unlinkSync, existsSync, chmodSync } from "fs";
import * as path from "path";
import * as fs from "fs";
import type { IPCRequest, IPCResponse, IPCStreamChunk } from "../types/index.js";
import { createLogger } from "./logger.js";

export type RequestHandler = (
  request: IPCRequest,
  sendChunk?: (chunk: IPCStreamChunk) => void
) => Promise<IPCResponse>;

export class IPCServer {
  private server: Server | null = null;
  private socketPath: string;
  private handler: RequestHandler;
  private connections: Set<Socket> = new Set();
  private logger = createLogger("ipc-server");

  constructor(socketPath: string, handler: RequestHandler) {
    this.socketPath = socketPath;
    this.handler = handler;
  }

  async start(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.socketPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Clean up existing socket
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer(this.handleConnection.bind(this));

      this.server.on("error", (err) => {
        this.logger.error("Server error", err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        // Set socket permissions (owner only)
        chmodSync(this.socketPath, 0o600);
        this.logger.info(`IPC server listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);
    this.logger.debug("New client connected");

    let buffer = "";

    socket.on("data", async (data) => {
      buffer += data.toString();

      // Messages are newline-delimited JSON
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request: IPCRequest = JSON.parse(line);
          this.logger.debug(`Received request: ${request.type}`);

          const sendChunk = (chunk: IPCStreamChunk) => {
            this.sendStreamChunk(socket, chunk);
          };
          const response = await this.handler(request, sendChunk);
          response.id = request.id;

          socket.write(JSON.stringify(response) + "\n");
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error("Request handling error", { error: errorMessage });

          socket.write(
            JSON.stringify({
              success: false,
              error: errorMessage,
            }) + "\n"
          );
        }
      }
    });

    socket.on("close", () => {
      this.connections.delete(socket);
      this.logger.debug("Client disconnected");
    });

    socket.on("error", (err) => {
      this.logger.error("Socket error", err);
      this.connections.delete(socket);
    });
  }

  sendStreamChunk(socket: Socket, chunk: IPCStreamChunk): void {
    if (!socket.destroyed) {
      socket.write(JSON.stringify(chunk) + "\n");
    }
  }

  async stop(): Promise<void> {
    // Close all connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    // Close server
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          // Clean up socket file
          if (existsSync(this.socketPath)) {
            unlinkSync(this.socketPath);
          }
          this.logger.info("IPC server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
