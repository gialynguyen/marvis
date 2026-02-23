import { describe, it, expect } from "vitest";
import { ConfigError } from "../src/config-error";

describe("ConfigError", () => {
  it("should format error with path and source", () => {
    const error = new ConfigError(
      "llm.provider",
      '"openai" | "anthropic" | "google"',
      "invalid",
      "~/.marvis/config.toml",
    );
    expect(error.message).toContain("llm.provider");
    expect(error.message).toContain("invalid");
    expect(error.message).toContain("config.toml");
  });

  it("should be instanceof Error", () => {
    const error = new ConfigError("path", "expected", "received", "source");
    expect(error).toBeInstanceOf(Error);
  });

  it("should have name ConfigError", () => {
    const error = new ConfigError("path", "expected", "received", "source");
    expect(error.name).toBe("ConfigError");
  });
});
