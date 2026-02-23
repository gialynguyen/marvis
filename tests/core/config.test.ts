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
});
