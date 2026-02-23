import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, DEFAULT_CONFIG } from "../../src/core/config.js";
import { type MarvisConfig } from "../../src/types/index.js";

describe("Config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return default config when no env vars set", () => {
    const config = loadConfig();
    expect(config.llm.provider).toBe("anthropic");
    expect(config.llm.model).toBe("claude-sonnet-4-0");
    expect(config.tools.confirmDangerous).toBe(true);
  });

  it("should override provider from env var", () => {
    process.env.MARVIS_PROVIDER = "openai";
    process.env.MARVIS_MODEL = "gpt-4o";
    const config = loadConfig();
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4o");
  });

  it("should override tool confirmation from env var", () => {
    process.env.MARVIS_CONFIRM_DANGEROUS = "false";
    const config = loadConfig();
    expect(config.tools.confirmDangerous).toBe(false);
  });

  it("should throw error for invalid provider", () => {
    process.env.MARVIS_PROVIDER = "invalid";
    expect(() => loadConfig()).toThrow(
      /Invalid MARVIS_PROVIDER: invalid/
    );
  });

  it("should throw error for invalid danger threshold", () => {
    process.env.MARVIS_DANGER_THRESHOLD = "invalid";
    expect(() => loadConfig()).toThrow(
      /Invalid MARVIS_DANGER_THRESHOLD: invalid/
    );
  });

  it("should accept valid danger thresholds", () => {
    process.env.MARVIS_DANGER_THRESHOLD = "moderate";
    const config = loadConfig();
    expect(config.tools.dangerThreshold).toBe("moderate");
  });

  it("should parse confirmDangerous correctly for true-like values", () => {
    process.env.MARVIS_CONFIRM_DANGEROUS = "true";
    const config = loadConfig();
    expect(config.tools.confirmDangerous).toBe(true);
  });

  it("should parse confirmDangerous correctly for any non-false value", () => {
    process.env.MARVIS_CONFIRM_DANGEROUS = "yes";
    const config = loadConfig();
    expect(config.tools.confirmDangerous).toBe(true);
  });
});
