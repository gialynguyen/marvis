import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IPCServer } from "../../src/daemon/ipc-server.js";
import { IPCClient } from "../../src/daemon/ipc-client.js";
import * as fs from "fs";

const TEST_SOCKET = "data/test.sock";

describe("IPCServer", () => {
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

  it("should start and accept connections", async () => {
    server = new IPCServer(TEST_SOCKET, async (req) => ({
      success: true,
      data: "pong",
    }));

    await server.start();
    expect(fs.existsSync(TEST_SOCKET)).toBe(true);
  });

  it("should handle requests and send responses", async () => {
    server = new IPCServer(TEST_SOCKET, async (req) => ({
      success: true,
      data: `echo: ${req.data?.message}`,
    }));

    await server.start();

    const client = new IPCClient(TEST_SOCKET);
    const response = await client.send({
      type: "status",
      data: { message: "hello" },
    });

    expect(response.success).toBe(true);
    expect(response.data).toBe("echo: hello");
  });

  it("should clean up socket on stop", async () => {
    server = new IPCServer(TEST_SOCKET, async () => ({ success: true }));
    await server.start();
    await server.stop();

    expect(fs.existsSync(TEST_SOCKET)).toBe(false);
  });
});
