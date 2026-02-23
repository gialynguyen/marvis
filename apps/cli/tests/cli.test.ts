import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createCLI, resetConfigCache } from "../src/cli/cli.js";

async function captureOutput(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
    errSpy.mockRestore();
  }
  return lines;
}
describe("marvis setup command", () => {
  let testDir: string;

  beforeEach(() => {
    resetConfigCache();
    testDir = join(tmpdir(), "marvis-cli-test-" + Date.now());
    mkdirSync(testDir, { recursive: true });
    process.env.MARVIS_CONFIG = join(testDir, "config.toml");
    process.env.MARVIS_DATA_DIR = join(testDir, "data");
    process.env.MARVIS_LOG_DIR = join(testDir, "logs");
  });

  afterEach(() => {
    delete process.env.MARVIS_CONFIG;
    delete process.env.MARVIS_DATA_DIR;
    delete process.env.MARVIS_LOG_DIR;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });
  it("should create config file if it does not exist", async () => {
    const program = createCLI();
    await captureOutput(() => program.parseAsync(["node", "marvis", "setup"]));
    expect(existsSync(join(testDir, "config.toml"))).toBe(true);
  });
  it("should create data directory if it does not exist", async () => {
    const program = createCLI();
    await captureOutput(() => program.parseAsync(["node", "marvis", "setup"]));
    expect(existsSync(join(testDir, "data"))).toBe(true);
  });
  it("should create log directory if it does not exist", async () => {
    const program = createCLI();
    await captureOutput(() => program.parseAsync(["node", "marvis", "setup"]));
    expect(existsSync(join(testDir, "logs"))).toBe(true);
  });
  it("should print config file path in output", async () => {
    const program = createCLI();
    const output = await captureOutput(() =>
      program.parseAsync(["node", "marvis", "setup"]),
    );
    expect(output.join("\n")).toContain("config.toml");
  });
  it("should not throw if config and directories already exist", async () => {
    writeFileSync(join(testDir, "config.toml"), "");
    mkdirSync(join(testDir, "data"), { recursive: true });
    mkdirSync(join(testDir, "logs"), { recursive: true });
    const program = createCLI();
    await expect(
      captureOutput(() => program.parseAsync(["node", "marvis", "setup"])),
    ).resolves.not.toThrow();
  });
});
describe("marvis health command", () => {
  let testDir: string;

  beforeEach(() => {
    resetConfigCache();
    testDir = join(tmpdir(), "marvis-health-test-" + Date.now());
    mkdirSync(testDir, { recursive: true });
    process.env.MARVIS_CONFIG = join(testDir, "config.toml");
    process.env.MARVIS_DATA_DIR = join(testDir, "data");
    process.env.MARVIS_LOG_DIR = join(testDir, "logs");
    process.env.MARVIS_SOCKET_PATH = join(testDir, "marvis.sock");
    mkdirSync(join(testDir, "data"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.MARVIS_CONFIG;
    delete process.env.MARVIS_DATA_DIR;
    delete process.env.MARVIS_LOG_DIR;
    delete process.env.MARVIS_SOCKET_PATH;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });
  it("should report daemon as not running when pid file does not exist", async () => {
    const program = createCLI();
    const output = await captureOutput(() =>
      program.parseAsync(["node", "marvis", "health"]),
    );
    expect(output.join("\n").toLowerCase()).toMatch(
      /not running|no pid|pid.*not found|daemon.*not/i,
    );
  });
  it("should report daemon as not running when pid file has stale pid", async () => {
    const pidFile = join(testDir, "data", "marvis.pid");
    writeFileSync(pidFile, "99999999");
    const program = createCLI();
    const output = await captureOutput(() =>
      program.parseAsync(["node", "marvis", "health"]),
    );
    expect(output.join("\n").toLowerCase()).toMatch(
      /not running|stale|dead|not found/i,
    );
  });
  it("should print health check results for each component", async () => {
    const program = createCLI();
    const output = await captureOutput(() =>
      program.parseAsync(["node", "marvis", "health"]),
    );
    const allOutput = output.join("\n");
    expect(allOutput.length).toBeGreaterThan(0);
    expect(allOutput.toLowerCase()).toMatch(/daemon|process|pid/i);
  });
});

describe("marvis reset command", () => {
  let testDir: string;

  beforeEach(() => {
    resetConfigCache();
    testDir = join(tmpdir(), "marvis-reset-test-" + Date.now());
    mkdirSync(testDir, { recursive: true });
    process.env.MARVIS_CONFIG = join(testDir, "config.toml");
    process.env.MARVIS_DATA_DIR = join(testDir, "data");
    process.env.MARVIS_LOG_DIR = join(testDir, "logs");
    process.env.MARVIS_SOCKET_PATH = join(testDir, "marvis.sock");
    // Create directories
    mkdirSync(join(testDir, "data"), { recursive: true });
    mkdirSync(join(testDir, "logs"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.MARVIS_CONFIG;
    delete process.env.MARVIS_DATA_DIR;
    delete process.env.MARVIS_LOG_DIR;
    delete process.env.MARVIS_SOCKET_PATH;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it("should remove the database file", async () => {
    const dbPath = join(testDir, "data", "marvis.db");
    writeFileSync(dbPath, "fake-db-content");
    expect(existsSync(dbPath)).toBe(true);

    const program = createCLI();
    const output = await captureOutput(() =>
      program.parseAsync(["node", "marvis", "reset", "--yes"]),
    );

    expect(existsSync(dbPath)).toBe(false);
    expect(output.join("\n")).toContain("Database:");
  });

  it("should remove SQLite WAL and SHM journal files", async () => {
    const dbPath = join(testDir, "data", "marvis.db");
    const walPath = dbPath + "-wal";
    const shmPath = dbPath + "-shm";
    writeFileSync(dbPath, "fake-db");
    writeFileSync(walPath, "fake-wal");
    writeFileSync(shmPath, "fake-shm");

    const program = createCLI();
    await captureOutput(() =>
      program.parseAsync(["node", "marvis", "reset", "--yes"]),
    );

    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(walPath)).toBe(false);
    expect(existsSync(shmPath)).toBe(false);
  });

  it("should remove the PID file", async () => {
    const pidFile = join(testDir, "data", "marvis.pid");
    writeFileSync(pidFile, "99999999");

    const program = createCLI();
    const output = await captureOutput(() =>
      program.parseAsync(["node", "marvis", "reset", "--yes"]),
    );

    expect(existsSync(pidFile)).toBe(false);
    expect(output.join("\n")).toContain("PID file:");
  });

  it("should remove the socket file", async () => {
    const socketFile = join(testDir, "marvis.sock");
    writeFileSync(socketFile, "");

    const program = createCLI();
    const output = await captureOutput(() =>
      program.parseAsync(["node", "marvis", "reset", "--yes"]),
    );

    expect(existsSync(socketFile)).toBe(false);
    expect(output.join("\n")).toContain("Socket:");
  });

  it("should clear all log files but keep the log directory", async () => {
    const logDir = join(testDir, "logs");
    writeFileSync(join(logDir, "marvis.log"), "log content");
    writeFileSync(join(logDir, "marvis.log.1"), "old log content");

    const program = createCLI();
    const output = await captureOutput(() =>
      program.parseAsync(["node", "marvis", "reset", "--yes"]),
    );

    expect(existsSync(logDir)).toBe(true);
    expect(existsSync(join(logDir, "marvis.log"))).toBe(false);
    expect(existsSync(join(logDir, "marvis.log.1"))).toBe(false);
    expect(output.join("\n")).toContain("Log:");
  });

  it("should NOT remove the config file", async () => {
    const configPath = join(testDir, "config.toml");
    writeFileSync(configPath, "[llm]\nprovider = 'anthropic'\n");

    // Also create some data files to reset
    writeFileSync(join(testDir, "data", "marvis.db"), "fake-db");

    const program = createCLI();
    await captureOutput(() =>
      program.parseAsync(["node", "marvis", "reset", "--yes"]),
    );

    expect(existsSync(configPath)).toBe(true);
  });

  it("should keep the data and log directories intact", async () => {
    writeFileSync(join(testDir, "data", "marvis.db"), "fake-db");

    const program = createCLI();
    await captureOutput(() =>
      program.parseAsync(["node", "marvis", "reset", "--yes"]),
    );

    expect(existsSync(join(testDir, "data"))).toBe(true);
    expect(existsSync(join(testDir, "logs"))).toBe(true);
  });

  it("should report nothing to reset when no data files exist", async () => {
    const program = createCLI();
    const output = await captureOutput(() =>
      program.parseAsync(["node", "marvis", "reset", "--yes"]),
    );

    expect(output.join("\n")).toContain("Nothing to reset");
  });
});
