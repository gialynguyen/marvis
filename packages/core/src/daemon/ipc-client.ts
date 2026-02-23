import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type { IPCRequest, IPCResponse, IPCRequestType, IPCStreamChunk } from "../types";

export class IPCClient {
  private socketPath: string;
  private socket?: Socket;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async send(request: Omit<IPCRequest, "id">): Promise<IPCResponse> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      const requestWithId: IPCRequest = {
        ...request,
        id: randomUUID(),
      };

      let buffer = "";
      let resolved = false;

      socket.on("connect", () => {
        socket.write(`${JSON.stringify(requestWithId)}\n`);
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

  async *sendStreaming(request: Omit<IPCRequest, "id">): AsyncGenerator<string, void, unknown> {
    const socket = createConnection(this.socketPath);
    const requestWithId: IPCRequest = {
      ...request,
      id: randomUUID(),
    };
    let buffer = "";
    const chunks: string[] = [];
    let done = false;
    let socketError: Error | null = null;
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(requestWithId)}\n`);
    });
    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id !== requestWithId.id) continue;

          if (parsed.type === undefined && "success" in parsed) {
            if (!parsed.success) {
              socketError = new Error(parsed.error ?? "Request failed");
            }
            done = true;
            socket.end();
          } else {
            const chunk = parsed as IPCStreamChunk;
            if (chunk.type === "done") {
              done = true;
              socket.end();
            } else if (chunk.type === "error") {
              socketError = new Error(chunk.error ?? "Stream error");
              done = true;
              socket.end();
            } else if (chunk.type === "text" && chunk.chunk) {
              chunks.push(chunk.chunk);
            }
          }
        } catch (e) {}
      }
    });
    socket.on("error", (err) => {
      socketError = err;
      done = true;
    });
    socket.on("close", () => {
      done = true;
    });
    while (!done || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    if (socketError) throw socketError;
  }

  async streamRequest(
    request: IPCRequest,
    onChunk: (chunk: IPCStreamChunk) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Not connected"));
        return;
      }

      const requestStr = `${JSON.stringify(request)}\n`;
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
