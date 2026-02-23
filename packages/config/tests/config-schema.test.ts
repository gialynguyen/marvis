import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { MarvisConfigSchema } from "../src/config-schema";
import { DEFAULT_CONFIG } from "../src/config";

describe("MarvisConfigSchema", () => {
  it("should validate DEFAULT_CONFIG", () => {
    const result = Value.Check(MarvisConfigSchema, DEFAULT_CONFIG);
    expect(result).toBe(true);
  });

  it("should reject invalid provider", () => {
    const invalid = {
      ...DEFAULT_CONFIG,
      llm: { ...DEFAULT_CONFIG.llm, provider: "invalid" },
    };
    const result = Value.Check(MarvisConfigSchema, invalid);
    expect(result).toBe(false);
  });

  it("should reject invalid log level", () => {
    const invalid = {
      ...DEFAULT_CONFIG,
      logging: { ...DEFAULT_CONFIG.logging, level: "verbose" },
    };
    const result = Value.Check(MarvisConfigSchema, invalid);
    expect(result).toBe(false);
  });

  it("should allow optional fields to be missing", () => {
    const config = { ...DEFAULT_CONFIG };
    // fallbackProvider is optional
    delete (config.llm as any).fallbackProvider;
    const result = Value.Check(MarvisConfigSchema, config);
    expect(result).toBe(true);
  });
});
