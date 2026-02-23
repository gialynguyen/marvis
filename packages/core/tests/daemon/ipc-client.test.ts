import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IPCServer } from "../../src/daemon/ipc-server";
import { IPCClient } from "../../src/daemon/ipc-client";
import * as fs from "fs";

const TEST_SOCKET = "data/test-client.sock";

describe("IPCClient", () => {
  let server: IPCServer;

  beforeEach(async () => {
    if (fs.existsSync(TEST_SOCKET)) {
      fs.unlinkSync(TEST_SOCKET);
    }
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    if (fs.existsSync(TEST_SOCKET)) {
      fs.unlinkSync(TEST_SOCKET);
    }
  });

  describe("sendStreaming", () => {
    it("should receive streamed text chunks from the server", async () => {
      server = new IPCServer(TEST_SOCKET, async (req, sendChunk) => {
        sendChunk!({ id: req.id, type: "text", chunk: "hello" });
        sendChunk!({ id: req.id, type: "text", chunk: " world" });
        sendChunk!({ id: req.id, type: "done" });
        return { success: true };
      });

      await server.start();

      const client = new IPCClient(TEST_SOCKET);
      const received: string[] = [];

      for await (const chunk of client.sendStreaming({
        type: "prompt",
        data: { message: "hi" },
      })) {
        received.push(chunk);
      }

      expect(received).toEqual(["hello", " world"]);
    });

    it("should send the request only after the socket connects", async () => {
      const receivedRequests: string[] = [];

      server = new IPCServer(TEST_SOCKET, async (req, sendChunk) => {
        receivedRequests.push(req.type);
        sendChunk!({ id: req.id, type: "done" });
        return { success: true };
      });

      await server.start();

      const client = new IPCClient(TEST_SOCKET);

      for await (const _ of client.sendStreaming({ type: "prompt" })) {
      }

      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0]).toBe("prompt");
    });

    it("should throw an error when the server returns a failure response", async () => {
      server = new IPCServer(TEST_SOCKET, async (req) => {
        return { id: req.id, success: false, error: "LLM API key invalid" };
      });

      await server.start();

      const client = new IPCClient(TEST_SOCKET);
      await expect(async () => {
        for await (const _ of client.sendStreaming({
          type: "prompt",
          data: { message: "hi" },
        })) {
        }
      }).rejects.toThrow("LLM API key invalid");
    });

    it("should throw a generic error when server returns failure with no message", async () => {
      server = new IPCServer(TEST_SOCKET, async (req) => {
        return { id: req.id, success: false };
      });

      await server.start();

      const client = new IPCClient(TEST_SOCKET);
      await expect(async () => {
        for await (const _ of client.sendStreaming({
          type: "prompt",
          data: { message: "hi" },
        })) {
        }
      }).rejects.toThrow("Request failed");
    });
  });
});
