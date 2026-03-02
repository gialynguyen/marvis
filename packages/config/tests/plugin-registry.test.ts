import { describe, it, expect, beforeEach } from "vitest";
import { PluginConfigRegistry } from "../src/plugin-registry";
import { Type } from "@sinclair/typebox";
import { MarvisConfigSchema } from "../src/types";

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
    expect(resolved.config).toEqual({ timeout: 10000, retries: 3 });
    expect(resolved.loadOnStartup).toBe(false);
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
    expect(toml).toContain("# Whether to load this plugin automatically at daemon startup");
    expect(toml).toContain("# load_on_startup = false");
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

  it("should generate TOML section with loadOnStartup default true", () => {
    registry.register({
      pluginId: "trading",
      pluginName: "Trading",
      schema: Type.Object({
        exchange: Type.Optional(Type.String()),
      }),
      defaults: { exchange: "binance" },
      loadOnStartup: true,
    });
    const toml = registry.generateTomlSection("trading");
    expect(toml).toContain("[plugins.trading]");
    expect(toml).toContain("# load_on_startup = true");
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
      expect(resolved.config).toEqual({
        defaultSymbols: ["BTCUSDT", "ETHUSDT", "PAXGUSDT"],
        webPort: 8080,
        exchange: "binance",
      });
      expect(resolved.loadOnStartup).toBe(false);
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
      expect(resolved.config).toEqual({
        defaultSymbols: ["ETHUSDT"],
        webPort: 9999,
      });
      expect(resolved.loadOnStartup).toBe(false);
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
      expect(resolved.config).toEqual({
        knownKey: "default",
        unknown_key: "value",
      });
      expect(resolved.loadOnStartup).toBe(false);
    });
  });

  describe("load_on_startup as first-class field", () => {
    it("should accept load_on_startup as boolean during validation", () => {
      registry.register({
        pluginId: "shell",
        pluginName: "Shell",
        schema: Type.Object({
          timeout: Type.Optional(Type.Number()),
        }),
        defaults: { timeout: 5000 },
      });
      const errors = registry.validate("shell", {
        timeout: 10000,
        load_on_startup: true,
      });
      expect(errors).toEqual([]);
    });

    it("should reject non-boolean load_on_startup during validation", () => {
      registry.register({
        pluginId: "shell",
        pluginName: "Shell",
        schema: Type.Object({
          timeout: Type.Optional(Type.Number()),
        }),
        defaults: { timeout: 5000 },
      });
      const errors = registry.validate("shell", {
        timeout: 10000,
        load_on_startup: "yes",
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("load_on_startup");
    });

    it("should separate load_on_startup from resolved plugin config", () => {
      registry.register({
        pluginId: "shell",
        pluginName: "Shell",
        schema: Type.Object({
          timeout: Type.Optional(Type.Number()),
        }),
        defaults: { timeout: 5000 },
      });
      const resolved = registry.resolve("shell", {
        timeout: 10000,
        load_on_startup: true,
      });
      expect(resolved.config).toEqual({ timeout: 10000 });
      expect(resolved.config).not.toHaveProperty("load_on_startup");
      expect(resolved.loadOnStartup).toBe(true);
    });

    it("should separate loadOnStartup (camelCase) from resolved config", () => {
      registry.register({
        pluginId: "test",
        pluginName: "Test",
        schema: Type.Object({
          foo: Type.Optional(Type.String()),
        }),
        defaults: { foo: "bar" },
      });
      const resolved = registry.resolve("test", {
        loadOnStartup: true,
      });
      expect(resolved.config).toEqual({ foo: "bar" });
      expect(resolved.config).not.toHaveProperty("loadOnStartup");
      expect(resolved.loadOnStartup).toBe(true);
    });

    it("should default loadOnStartup to false when not specified", () => {
      registry.register({
        pluginId: "test",
        pluginName: "Test",
        schema: Type.Object({
          foo: Type.Optional(Type.String()),
        }),
        defaults: { foo: "bar" },
      });
      const resolved = registry.resolve("test", {});
      expect(resolved.loadOnStartup).toBe(false);
    });

    it("should use entry-level loadOnStartup default", () => {
      registry.register({
        pluginId: "test",
        pluginName: "Test",
        schema: Type.Object({
          foo: Type.Optional(Type.String()),
        }),
        defaults: { foo: "bar" },
        loadOnStartup: true,
      });
      const resolved = registry.resolve("test", {});
      expect(resolved.loadOnStartup).toBe(true);
    });

    it("should let user override entry-level loadOnStartup default", () => {
      registry.register({
        pluginId: "test",
        pluginName: "Test",
        schema: Type.Object({
          foo: Type.Optional(Type.String()),
        }),
        defaults: { foo: "bar" },
        loadOnStartup: true,
      });
      const resolved = registry.resolve("test", {
        load_on_startup: false,
      });
      expect(resolved.loadOnStartup).toBe(false);
    });

    it("should validate load_on_startup alongside other snake_case keys", () => {
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
        default_symbols: ["ETHUSDT"],
        web_port: 8080,
        load_on_startup: false,
      });
      expect(errors).toEqual([]);
    });
  });

  describe("getFullSchema", () => {
    it("should return core schema as JSON-serializable object", () => {
      const result = registry.getFullSchema(MarvisConfigSchema);

      expect(result.core).toBeDefined();
      expect(result.core.type).toBe("object");
      expect(result.core.properties).toBeDefined();

      // Verify it's JSON-serializable (no symbols)
      const serialized = JSON.stringify(result.core);
      const parsed = JSON.parse(serialized);
      expect(parsed.type).toBe("object");
    });

    it("should include core config schema properties", () => {
      const result = registry.getFullSchema(MarvisConfigSchema);
      const properties = result.core.properties as Record<string, unknown>;

      expect(properties).toHaveProperty("llm");
      expect(properties).toHaveProperty("tools");
      expect(properties).toHaveProperty("system");
      expect(properties).toHaveProperty("paths");
      expect(properties).toHaveProperty("logging");
      expect(properties).toHaveProperty("plugins");
      expect(properties).toHaveProperty("aliases");
    });

    it("should include registered plugin schemas", () => {
      registry.register({
        pluginId: "shell",
        pluginName: "Shell Commands",
        schema: Type.Object({
          defaultTimeout: Type.Optional(Type.Number()),
          maxBufferSize: Type.Optional(Type.Number()),
        }),
        defaults: { defaultTimeout: 30000, maxBufferSize: 10485760 },
        descriptions: {
          defaultTimeout: "Default command timeout in ms",
          maxBufferSize: "Max output buffer size in bytes",
        },
      });

      const result = registry.getFullSchema(MarvisConfigSchema);

      expect(result.plugins).toHaveProperty("shell");
      expect(result.plugins.shell.pluginName).toBe("Shell Commands");
      expect(result.plugins.shell.defaults).toEqual({
        defaultTimeout: 30000,
        maxBufferSize: 10485760,
      });
      expect(result.plugins.shell.descriptions).toEqual({
        defaultTimeout: "Default command timeout in ms",
        maxBufferSize: "Max output buffer size in bytes",
      });

      // Schema should be JSON-serializable
      const serialized = JSON.stringify(result.plugins.shell.schema);
      const parsed = JSON.parse(serialized);
      expect(parsed.type).toBe("object");
      expect(parsed.properties).toBeDefined();
    });

    it("should return empty plugins when no plugins registered", () => {
      const result = registry.getFullSchema(MarvisConfigSchema);
      expect(result.plugins).toEqual({});
    });

    it("should include multiple plugins", () => {
      registry.register({
        pluginId: "shell",
        pluginName: "Shell",
        schema: Type.Object({ timeout: Type.Optional(Type.Number()) }),
        defaults: { timeout: 5000 },
      });
      registry.register({
        pluginId: "trading",
        pluginName: "Trading",
        schema: Type.Object({
          exchange: Type.Optional(Type.String()),
          webPort: Type.Optional(Type.Number()),
        }),
        defaults: { exchange: "binance", webPort: 3456 },
      });

      const result = registry.getFullSchema(MarvisConfigSchema);

      expect(Object.keys(result.plugins)).toEqual(["shell", "trading"]);
      expect(result.plugins.shell.pluginName).toBe("Shell");
      expect(result.plugins.trading.pluginName).toBe("Trading");
    });

    it("should provide empty descriptions when none declared", () => {
      registry.register({
        pluginId: "test",
        pluginName: "Test",
        schema: Type.Object({ foo: Type.Optional(Type.String()) }),
        defaults: { foo: "bar" },
      });

      const result = registry.getFullSchema(MarvisConfigSchema);
      expect(result.plugins.test.descriptions).toEqual({});
    });

    it("should strip TypeBox internal symbols from schemas", () => {
      registry.register({
        pluginId: "test",
        pluginName: "Test",
        schema: Type.Object({
          mode: Type.Union([Type.Literal("fast"), Type.Literal("slow")]),
        }),
        defaults: { mode: "fast" },
      });

      const result = registry.getFullSchema(MarvisConfigSchema);

      // The entire result should be safely JSON-serializable
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json);

      // Verify plugin schema union constraint is preserved
      const modeSchema = parsed.plugins.test.schema.properties.mode;
      expect(modeSchema.anyOf).toBeDefined();
      expect(modeSchema.anyOf.length).toBe(2);
    });

    it("should be fully JSON-serializable end-to-end", () => {
      registry.register({
        pluginId: "shell",
        pluginName: "Shell",
        schema: Type.Object({
          allowedCommands: Type.Optional(Type.Array(Type.String())),
          defaultTimeout: Type.Optional(Type.Number()),
        }),
        defaults: { defaultTimeout: 30000 },
        descriptions: { defaultTimeout: "Timeout in ms" },
      });

      const result = registry.getFullSchema(MarvisConfigSchema);

      // Must not throw
      const json = JSON.stringify(result);
      expect(json).toBeTruthy();

      // Round-trip parse should preserve structure
      const parsed = JSON.parse(json);
      expect(parsed.core.type).toBe("object");
      expect(parsed.plugins.shell.pluginName).toBe("Shell");
      expect(parsed.plugins.shell.defaults.defaultTimeout).toBe(30000);
    });
  });
});
