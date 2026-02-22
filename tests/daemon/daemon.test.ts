// tests/daemon/daemon.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MarvisDaemon } from "../../src/daemon/daemon.js";
import { IPCClient } from "../../src/daemon/ipc-client.js";
import * as fs from "fs";

const TEST_CONFIG = {
  socketPath: "data/test-daemon.sock",
  pidFile: "data/test-daemon.pid",
  logFile: "data/test-daemon.log",
  dbPath: "data/test-daemon.db",
  marvisConfig: {
    alwaysLocal: true, // Don't try to connect to cloud
  },
};

describe("MarvisDaemon", () => {
  let daemon: MarvisDaemon;

  beforeEach(() => {
    // Clean up test files
    for (const file of [
      TEST_CONFIG.socketPath,
      TEST_CONFIG.pidFile,
      TEST_CONFIG.dbPath,
    ]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
    }
    // Clean up test files
    for (const file of [
      TEST_CONFIG.socketPath,
      TEST_CONFIG.pidFile,
      TEST_CONFIG.dbPath,
    ]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  it("should start and create PID file", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    expect(fs.existsSync(TEST_CONFIG.pidFile)).toBe(true);
    expect(fs.existsSync(TEST_CONFIG.socketPath)).toBe(true);
  });

  it("should respond to status request", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    const client = new IPCClient(TEST_CONFIG.socketPath);
    const response = await client.send({ type: "status" });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("uptime");
    expect(response.data).toHaveProperty("pid");
  });

  it("should clean up on shutdown", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();
    await daemon.shutdown();

    expect(fs.existsSync(TEST_CONFIG.pidFile)).toBe(false);
    expect(fs.existsSync(TEST_CONFIG.socketPath)).toBe(false);
  });
});
