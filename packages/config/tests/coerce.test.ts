import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { coerceValue } from "../src/coerce";

describe("coerceValue", () => {
  const schema = Type.Object({
    timeout: Type.Optional(Type.Number()),
    enabled: Type.Optional(Type.Boolean()),
    name: Type.Optional(Type.String()),
    symbols: Type.Optional(Type.Array(Type.String())),
    webPort: Type.Optional(Type.Number()),
  });

  describe("string → boolean coercion", () => {
    it('should coerce "true" to true when schema expects boolean', () => {
      expect(coerceValue(schema, "enabled", "true")).toBe(true);
    });

    it('should coerce "false" to false when schema expects boolean', () => {
      expect(coerceValue(schema, "enabled", "false")).toBe(false);
    });

    it("should pass through actual booleans", () => {
      expect(coerceValue(schema, "enabled", true)).toBe(true);
      expect(coerceValue(schema, "enabled", false)).toBe(false);
    });
  });

  describe("string → number coercion", () => {
    it('should coerce "3456" to 3456 when schema expects number', () => {
      expect(coerceValue(schema, "timeout", "3456")).toBe(3456);
    });

    it('should coerce "0" to 0', () => {
      expect(coerceValue(schema, "timeout", "0")).toBe(0);
    });

    it("should pass through actual numbers", () => {
      expect(coerceValue(schema, "timeout", 42)).toBe(42);
    });
  });

  describe("string → string (no coercion needed)", () => {
    it("should leave strings alone when schema expects string", () => {
      expect(coerceValue(schema, "name", "hello")).toBe("hello");
    });
  });

  describe("JSON string → array coercion", () => {
    it("should parse JSON array strings", () => {
      expect(coerceValue(schema, "symbols", '["BTCUSDT", "ETHUSDT"]')).toEqual(["BTCUSDT", "ETHUSDT"]);
    });

    it("should pass through actual arrays", () => {
      expect(coerceValue(schema, "symbols", ["BTCUSDT"])).toEqual(["BTCUSDT"]);
    });

    it("should return invalid JSON array strings coerced by schema if possible", () => {
      // "[invalid" starts with "[" but isn't valid JSON, so JSON parse fails.
      // Value.Convert on an array schema wraps the string into an array.
      expect(coerceValue(schema, "symbols", "[invalid")).toEqual(["[invalid"]);
    });
  });

  describe("JSON string → object coercion", () => {
    it("should parse JSON object strings", () => {
      expect(coerceValue(schema, "unknown", '{"key": "val"}')).toEqual({ key: "val" });
    });
  });

  describe("snake_case ↔ camelCase key lookup", () => {
    it("should coerce using snake_case key against camelCase schema property", () => {
      expect(coerceValue(schema, "web_port", "8080")).toBe(8080);
    });
  });

  describe("load_on_startup special handling", () => {
    it('should coerce load_on_startup "true" to boolean true', () => {
      expect(coerceValue(schema, "load_on_startup", "true")).toBe(true);
    });

    it('should coerce load_on_startup "false" to boolean false', () => {
      expect(coerceValue(schema, "load_on_startup", "false")).toBe(false);
    });

    it('should coerce loadOnStartup "true" to boolean true', () => {
      expect(coerceValue(schema, "loadOnStartup", "true")).toBe(true);
    });

    it("should pass through boolean load_on_startup", () => {
      expect(coerceValue(schema, "load_on_startup", true)).toBe(true);
    });
  });

  describe("unknown keys", () => {
    it("should return value as-is for unknown keys", () => {
      expect(coerceValue(schema, "unknown_key", "some_value")).toBe("some_value");
    });

    it("should still parse JSON arrays for unknown keys", () => {
      expect(coerceValue(schema, "unknown_key", '["a", "b"]')).toEqual(["a", "b"]);
    });
  });

  describe("empty schema", () => {
    it("should handle empty schema gracefully", () => {
      const emptySchema = Type.Object({});
      expect(coerceValue(emptySchema, "any_key", "value")).toBe("value");
    });
  });
});
