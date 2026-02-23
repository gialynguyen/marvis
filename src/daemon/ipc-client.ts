import { createConnection, Socket } from "net";
import { randomUUID } from "crypto";
import type { IPCRequest, IPCResponse, IPCRequestType, IPCStreamChunk } from "../types/index.js";

export class IPCClient {
  private socketPath: string;
  private socket?: Socket;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async send(
    request: Omit<IPCRequest, "id">
  ): Promise<IPCResponse> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      const requestWithId: IPCRequest = {
        ...request,
        id: randomUUID(),
      };

      let buffer = "";
      let resolved = false;

      socket.on("connect", () => {
        socket.write(JSON.stringify(requestWithId) + "\n");
      });

      socket.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const response: IPCResponse = JSON.parse(line);
            if (response.id === requestWithId.id) {
              resolved = true;
              socket.end();
              resolve(response);
            }
          } catch (e) {
            // Ignore parse errors for incomplete messages
          }
        }
      });

      socket.on("error", (err) => {
        if (!resolved) {
          reject(err);
        }
      });

      socket.on("close", () => {
        if (!resolved) {
          reject(new Error("Connection closed before response received"));
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!resolved) {
          socket.destroy();
          reject(new Error("Request timed out"));
        }
      }, 30000);
    });
  }

  async *sendStreaming(
    request: Omit<IPCRequest, "id">
  ): AsyncGenerator<string, void, unknown> {
    const socket = createConnection(this.socketPath);
    const requestWithId: IPCRequest = {
      ...request,
      id: randomUUID(),
    };

    let buffer = "";

    socket.write(JSON.stringify(requestWithId) + "\n");

    const chunks: string[] = [];
    let done = false;

    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const response: IPCStreamChunk = JSON.parse(line);
          if (response.id === requestWithId.id) {
            if (response.type === "done" || response.type === "error") {
              done = true;
              socket.end();
            } else if (response.type === "text" && response.chunk) {
              chunks.push(response.chunk);
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    });

    // Yield chunks as they arrive
    while (!done || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
  }

  async streamRequest(
    request: IPCRequest,
    onChunk: (chunk: IPCStreamChunk) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Not connected"));
        return;
      }

      const requestStr = JSON.stringify(request) + "\n";
      this.socket.write(requestStr);

      let buffer = "";

      const handleData = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as IPCStreamChunk;
            onChunk(chunk);
            if (chunk.type === "done" || chunk.type === "error") {
              cleanup();
              resolve();
            }
          } catch (e) {
            // Non-JSON response, treat as regular response
            cleanup();
            resolve();
          }
        }
      };

      const cleanup = () => {
        this.socket?.off("data", handleData);
      };

      this.socket.on("data", handleData);
    });
  }
}
