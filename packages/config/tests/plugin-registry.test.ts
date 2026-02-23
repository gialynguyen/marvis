import { describe, it, expect, beforeEach } from "vitest";
import { PluginConfigRegistry } from "../src/plugin-registry";
import { Type } from "@sinclair/typebox";

describe("PluginConfigRegistry", () => {
  let registry: PluginConfigRegistry;

  beforeEach(() => {
    registry = new PluginConfigRegistry();
  });

  it("should register a plugin config entry", () => {
    registry.register({
      pluginId: "test",
      pluginName: "Test Plugin",
      schema: Type.Object({
        timeout: Type.Optional(Type.Number()),
      }),
      defaults: { timeout: 5000 },
    });

    expect(registry.listRegistered()).toEqual(["test"]);
  });

  it("should throw on duplicate registration", () => {
    const entry = {
      pluginId: "test",
      pluginName: "Test Plugin",
      schema: Type.Object({}),
      defaults: {},
    };
    registry.register(entry);
    expect(() => registry.register(entry)).toThrow(/already registered/);
  });

  it("should unregister a plugin", () => {
    registry.register({
      pluginId: "test",
      pluginName: "Test Plugin",
      schema: Type.Object({}),
      defaults: {},
    });
    registry.unregister("test");
    expect(registry.listRegistered()).toEqual([]);
  });

  it("should get a registered entry", () => {
    registry.register({
      pluginId: "test",
      pluginName: "Test Plugin",
      schema: Type.Object({}),
      defaults: { foo: "bar" },
    });
    const entry = registry.get("test");
    expect(entry?.pluginId).toBe("test");
    expect(entry?.defaults).toEqual({ foo: "bar" });
  });

  it("should return undefined for unregistered plugin", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("should validate valid config", () => {
    registry.register({
      pluginId: "test",
      pluginName: "Test Plugin",
      schema: Type.Object({
        timeout: Type.Optional(Type.Number()),
      }),
      defaults: { timeout: 5000 },
    });
    const errors = registry.validate("test", { timeout: 10000 });
    expect(errors).toEqual([]);
  });

  it("should validate invalid config", () => {
    registry.register({
      pluginId: "test",
      pluginName: "Test Plugin",
      schema: Type.Object({
        timeout: Type.Optional(Type.Number()),
      }),
      defaults: { timeout: 5000 },
    });
    const errors = registry.validate("test", { timeout: "not a number" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("should return error for unknown plugin validation", () => {
    const errors = registry.validate("unknown", {});
    expect(errors).toEqual(["Unknown plugin: unknown"]);
  });

  it("should resolve config with defaults", () => {
    registry.register({
      pluginId: "test",
      pluginName: "Test Plugin",
      schema: Type.Object({
        timeout: Type.Optional(Type.Number()),
        retries: Type.Optional(Type.Number()),
      }),
      defaults: { timeout: 5000, retries: 3 },
    });
    const resolved = registry.resolve("test", { timeout: 10000 });
    expect(resolved).toEqual({ timeout: 10000, retries: 3 });
  });

  it("should throw when resolving unknown plugin", () => {
    expect(() => registry.resolve("unknown")).toThrow(/Unknown plugin/);
  });

  it("should generate TOML section for a plugin", () => {
    registry.register({
      pluginId: "shell",
      pluginName: "Shell",
      schema: Type.Object({
        timeout: Type.Optional(Type.Number()),
      }),
      defaults: { timeout: 30000 },
      descriptions: { timeout: "Command timeout in ms" },
    });
    const toml = registry.generateTomlSection("shell");
    expect(toml).toContain("[plugins.shell]");
    expect(toml).toContain("# Command timeout in ms");
    expect(toml).toContain("# timeout = 30000");
  });

  it("should generate TOML section with snake_case keys", () => {
    registry.register({
      pluginId: "trading",
      pluginName: "Trading",
      schema: Type.Object({
        defaultSymbols: Type.Optional(Type.Array(Type.String())),
        webPort: Type.Optional(Type.Number()),
      }),
      defaults: { defaultSymbols: ["BTCUSDT"], webPort: 3456 },
      descriptions: { defaultSymbols: "Default trading pairs", webPort: "Dashboard port" },
    });
    const toml = registry.generateTomlSection("trading");
    expect(toml).toContain("# default_symbols =");
    expect(toml).toContain("# web_port = 3456");
    expect(toml).not.toContain("defaultSymbols");
    expect(toml).not.toContain("webPort");
  });

  it("should generate all plugin TOML sections", () => {
    registry.register({
      pluginId: "shell",
      pluginName: "Shell",
      schema: Type.Object({}),
      defaults: { timeout: 30000 },
    });
    registry.register({
      pluginId: "trading",
      pluginName: "Trading",
      schema: Type.Object({}),
      defaults: { exchange: "binance" },
    });
    const toml = registry.generateAllPluginToml();
    expect(toml).toContain("[plugins.shell]");
    expect(toml).toContain("[plugins.trading]");
  });

  it("should get all entries", () => {
    registry.register({
      pluginId: "a",
      pluginName: "A",
      schema: Type.Object({}),
      defaults: {},
    });
    registry.register({
      pluginId: "b",
      pluginName: "B",
      schema: Type.Object({}),
      defaults: {},
    });
    const all = registry.getAll();
    expect(all.length).toBe(2);
    expect(all.map((e) => e.pluginId)).toEqual(["a", "b"]);
  });

  describe("snake_case to camelCase key normalization", () => {
    it("should resolve config with snake_case keys from TOML", () => {
      registry.register({
        pluginId: "trading",
        pluginName: "Trading",
        schema: Type.Object({
          defaultSymbols: Type.Optional(Type.Array(Type.String())),
          webPort: Type.Optional(Type.Number()),
          exchange: Type.Optional(Type.String()),
        }),
        defaults: { defaultSymbols: ["BTCUSDT"], webPort: 3456, exchange: "binance" },
      });
      const resolved = registry.resolve("trading", {
        default_symbols: ["BTCUSDT", "ETHUSDT", "PAXGUSDT"],
        web_port: 8080,
      });
      expect(resolved).toEqual({
        defaultSymbols: ["BTCUSDT", "ETHUSDT", "PAXGUSDT"],
        webPort: 8080,
        exchange: "binance",
      });
    });

    it("should validate config with snake_case keys", () => {
      registry.register({
        pluginId: "trading",
        pluginName: "Trading",
        schema: Type.Object({
          defaultSymbols: Type.Optional(Type.Array(Type.String())),
          webPort: Type.Optional(Type.Number()),
        }),
        defaults: { defaultSymbols: ["BTCUSDT"], webPort: 3456 },
      });
      const errors = registry.validate("trading", {
        default_symbols: ["BTCUSDT", "ETHUSDT"],
        web_port: 8080,
      });
      expect(errors).toEqual([]);
    });

    it("should still accept camelCase keys directly", () => {
      registry.register({
        pluginId: "trading",
        pluginName: "Trading",
        schema: Type.Object({
          defaultSymbols: Type.Optional(Type.Array(Type.String())),
          webPort: Type.Optional(Type.Number()),
        }),
        defaults: { defaultSymbols: ["BTCUSDT"], webPort: 3456 },
      });
      const resolved = registry.resolve("trading", {
        defaultSymbols: ["ETHUSDT"],
        webPort: 9999,
      });
      expect(resolved).toEqual({
        defaultSymbols: ["ETHUSDT"],
        webPort: 9999,
      });
    });

    it("should leave unknown snake_case keys untouched", () => {
      registry.register({
        pluginId: "test",
        pluginName: "Test",
        schema: Type.Object({
          knownKey: Type.Optional(Type.String()),
        }),
        defaults: { knownKey: "default" },
      });
      const resolved = registry.resolve("test", {
        unknown_key: "value",
      });
      expect(resolved).toEqual({
        knownKey: "default",
        unknown_key: "value",
      });
    });
  });
});
