import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLogger, Logger, LogLevel } from "../../src/daemon/logger";

describe("Logger", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createLogger("test");
  });

  it("should create a logger with a name", () => {
    expect(logger).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.debug).toBeDefined();
  });

  it("should format log messages with timestamp and level", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test message");

    expect(consoleSpy).toHaveBeenCalled();
    const loggedMessage = consoleSpy.mock.calls[0][0];
    expect(loggedMessage).toContain("[test]");
    expect(loggedMessage).toContain("[INFO]");
    expect(loggedMessage).toContain("test message");

    consoleSpy.mockRestore();
  });

  it("should include additional data in log output", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test message", { key: "value" });

    const loggedMessage = consoleSpy.mock.calls[0][0];
    expect(loggedMessage).toContain("key");
    expect(loggedMessage).toContain("value");

    consoleSpy.mockRestore();
  });
});
