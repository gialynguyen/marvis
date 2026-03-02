import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Type } from "@sinclair/typebox";
import { PluginConfigRegistry, type MarvisConfig, DEFAULT_CONFIG } from "@marvis/config";
import {
  getConfig,
  getConfigValue,
  setConfigValue,
  listPlugins,
  getPluginConfig,
  setPluginConfig,
  resetPluginConfig,
  getConfigSchema,
} from "../src/tools";

describe("Config Plugin Tools", () => {
  const testDir = join(tmpdir(), "marvis-config-plugin-test-" + Date.now());
  const configPath = join(testDir, "config.toml");
  let registry: PluginConfigRegistry;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.MARVIS_CONFIG = configPath;

    registry = new PluginConfigRegistry();
    registry.register({
      pluginId: "shell",
      pluginName: "Shell Commands",
      schema: Type.Object({
        default_timeout: Type.Optional(Type.Number()),
        max_buffer_size: Type.Optional(Type.Number()),
      }),
      defaults: { default_timeout: 30000, max_buffer_size: 10485760 },
      descriptions: {
        default_timeout: "Default command timeout in milliseconds",
        max_buffer_size: "Maximum output buffer size in bytes",
      },
    });
    registry.register({
      pluginId: "trading",
      pluginName: "Trading",
      schema: Type.Object({
        exchange: Type.Optional(Type.String()),
        webPort: Type.Optional(Type.Number()),
        defaultSymbols: Type.Optional(Type.Array(Type.String())),
      }),
      defaults: { exchange: "binance", webPort: 3456, defaultSymbols: ["BTCUSDT", "ETHUSDT"] },
      descriptions: {
        exchange: "Exchange to connect to",
        webPort: "Port for web dashboard",
        defaultSymbols: "Default trading pairs to track",
      },
    });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    delete process.env.MARVIS_CONFIG;
  });

  describe("getConfig", () => {
    it("should return full config", () => {
      const result = getConfig(DEFAULT_CONFIG);
      expect(result).toHaveProperty("llm");
      expect(result).toHaveProperty("tools");
      expect(result).toHaveProperty("paths");
    });

    it("should return a specific section", () => {
      const result = getConfig(DEFAULT_CONFIG, "llm");
      expect(result).toHaveProperty("llm");
      expect(result).not.toHaveProperty("tools");
    });

    it("should throw for unknown section", () => {
      expect(() => getConfig(DEFAULT_CONFIG, "nonexistent")).toThrow(/Unknown config section/);
    });

    it("should redact apiKey", () => {
      const configWithKey = {
        ...DEFAULT_CONFIG,
        llm: { ...DEFAULT_CONFIG.llm, apiKey: "sk-secret-key" },
      };
      const result = getConfig(configWithKey);
      expect((result.llm as any).apiKey).toBe("***REDACTED***");
    });
  });

  describe("getConfigValue", () => {
    it("should get a top-level section", () => {
      const value = getConfigValue(DEFAULT_CONFIG, "llm");
      expect(value).toHaveProperty("provider");
    });

    it("should get a nested value", () => {
      const value = getConfigValue(DEFAULT_CONFIG, "llm.provider");
      expect(value).toBe("anthropic");
    });

    it("should throw for nonexistent path", () => {
      expect(() => getConfigValue(DEFAULT_CONFIG, "llm.nonexistent")).toThrow(/not found/);
    });

    it("should redact apiKey", () => {
      const configWithKey = {
        ...DEFAULT_CONFIG,
        llm: { ...DEFAULT_CONFIG.llm, apiKey: "sk-secret-key" },
      };
      const value = getConfigValue(configWithKey, "llm.apiKey");
      expect(value).toBe("***REDACTED***");
    });
  });

  describe("setConfigValue", () => {
    it("should write a value to TOML file", () => {
      writeFileSync(configPath, '[llm]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-0"\n');
      const { updatedSection } = setConfigValue("llm.model", "gpt-4o");
      expect(updatedSection).toHaveProperty("llm");

      // Verify the file was written
      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("gpt-4o");
    });

    it("should create nested sections if needed", () => {
      writeFileSync(configPath, "");
      setConfigValue("logging.level", "debug");
      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("debug");
    });
  });

  describe("listPlugins", () => {
    it("should list all registered plugins", () => {
      const plugins = listPlugins(registry);
      expect(plugins.length).toBe(2);
      expect(plugins[0].id).toBe("shell");
      expect(plugins[1].id).toBe("trading");
    });

    it("should show config fields", () => {
      const plugins = listPlugins(registry);
      const shell = plugins.find((p) => p.id === "shell");
      expect(shell?.configFields).toContain("default_timeout");
      expect(shell?.hasConfig).toBe(true);
    });
  });

  describe("getPluginConfig", () => {
    it("should return plugin config details", () => {
      const result = getPluginConfig(registry, DEFAULT_CONFIG, "shell");
      expect(result.defaults).toHaveProperty("default_timeout");
      expect(result.descriptions).toHaveProperty("default_timeout");
    });

    it("should throw for unknown plugin", () => {
      expect(() => getPluginConfig(registry, DEFAULT_CONFIG, "unknown")).toThrow(/not found/);
    });
  });

  describe("setPluginConfig", () => {
    it("should update plugin config in TOML", () => {
      writeFileSync(configPath, "");
      const { updatedConfig } = setPluginConfig(registry, "trading", "exchange", "binance");
      expect(updatedConfig).toHaveProperty("exchange", "binance");

      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("binance");
    });

    it("should throw for unknown plugin", () => {
      writeFileSync(configPath, "");
      expect(() => setPluginConfig(registry, "unknown", "key", "value")).toThrow(/not found/);
    });

    it("should validate config against schema", () => {
      writeFileSync(configPath, "");
      expect(() => setPluginConfig(registry, "trading", "webPort", "not-a-number")).toThrow(
        /Invalid config/,
      );
    });

    it("should coerce JSON string arrays into actual arrays", () => {
      writeFileSync(configPath, "");
      const { updatedConfig } = setPluginConfig(
        registry,
        "trading",
        "default_symbols",
        '["BTCUSDT", "ETHUSDT", "PAXGUSDT"]',
      );
      expect(updatedConfig.defaultSymbols).toEqual(["BTCUSDT", "ETHUSDT", "PAXGUSDT"]);

      // Verify TOML file has a proper array, not a string
      const content = readFileSync(configPath, "utf-8");
      expect(content).not.toContain('"[');
      expect(content).toContain("PAXGUSDT");
    });

    it("should accept actual arrays without coercion", () => {
      writeFileSync(configPath, "");
      const { updatedConfig } = setPluginConfig(
        registry,
        "trading",
        "default_symbols",
        ["BTCUSDT", "SOLUSDT"],
      );
      expect(updatedConfig.defaultSymbols).toEqual(["BTCUSDT", "SOLUSDT"]);
    });

    it("should normalize camelCase keys to snake_case in TOML", () => {
      writeFileSync(configPath, "");
      setPluginConfig(registry, "trading", "defaultSymbols", ["BTCUSDT"]);

      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("default_symbols");
      expect(content).not.toContain("defaultSymbols");
    });

    it("should accept snake_case keys and write them as snake_case", () => {
      writeFileSync(configPath, "");
      setPluginConfig(registry, "trading", "web_port", 8080);

      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("web_port");
      expect(content).not.toContain("webPort");
    });

    it("should not leave duplicate keys when switching between casings", () => {
      writeFileSync(configPath, '[plugins.trading]\ndefaultSymbols = ["OLD"]\n');
      setPluginConfig(registry, "trading", "default_symbols", ["NEW"]);

      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("default_symbols");
      expect(content).not.toContain("defaultSymbols");
      expect(content).toContain("NEW");
      expect(content).not.toContain("OLD");
    });

    it("should coerce string 'true' to boolean for load_on_startup", () => {
      writeFileSync(configPath, "");
      // load_on_startup is not in the trading schema but is a daemon-level key
      // coerceValue should handle it via special-case boolean coercion
      const { updatedConfig } = setPluginConfig(registry, "trading", "load_on_startup", "true");
      // The function should succeed without validation error
      expect(updatedConfig).toBeDefined();
    });

    it("should coerce string number to actual number for schema fields", () => {
      writeFileSync(configPath, "");
      const { updatedConfig } = setPluginConfig(registry, "trading", "web_port", "8080");
      expect(updatedConfig.webPort).toBe(8080);
    });
  });

  describe("resetPluginConfig", () => {
    it("should reset all plugin config to defaults", () => {
      writeFileSync(configPath, '[plugins.trading]\nexchange = "kraken"\nweb_port = 9999\n');
      const { updatedConfig } = resetPluginConfig(registry, "trading");
      expect(updatedConfig).toEqual({ exchange: "binance", webPort: 3456, defaultSymbols: ["BTCUSDT", "ETHUSDT"] });
    });

    it("should reset a single key using snake_case", () => {
      writeFileSync(configPath, '[plugins.trading]\nexchange = "kraken"\nweb_port = 9999\n');
      resetPluginConfig(registry, "trading", "exchange");

      const content = readFileSync(configPath, "utf-8");
      // After reset, the exchange key should be set back to default
      expect(content).toContain("binance");
    });

    it("should reset a single key using camelCase", () => {
      writeFileSync(configPath, '[plugins.trading]\nweb_port = 9999\n');
      resetPluginConfig(registry, "trading", "webPort");

      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("web_port = 3456");
      expect(content).not.toContain("webPort");
    });

    it("should throw for unknown plugin", () => {
      expect(() => resetPluginConfig(registry, "unknown")).toThrow(/not found/);
    });
  });

  describe("getConfigSchema", () => {
    it("should return unified schema with core and plugins", () => {
      const schema = getConfigSchema(registry);

      // Core schema
      expect(schema.core).toBeDefined();
      expect(schema.core.type).toBe("object");
      expect(schema.core.properties).toBeDefined();
      const coreProps = schema.core.properties as Record<string, unknown>;
      expect(coreProps).toHaveProperty("llm");
      expect(coreProps).toHaveProperty("tools");
      expect(coreProps).toHaveProperty("plugins");

      // Plugin schemas
      expect(schema.plugins).toBeDefined();
      expect(schema.plugins).toHaveProperty("shell");
      expect(schema.plugins).toHaveProperty("trading");
    });

    it("should include plugin metadata in schema", () => {
      const schema = getConfigSchema(registry);

      const shell = schema.plugins.shell;
      expect(shell.pluginName).toBe("Shell Commands");
      expect(shell.defaults).toEqual({ default_timeout: 30000, max_buffer_size: 10485760 });
      expect(shell.descriptions).toEqual({
        default_timeout: "Default command timeout in milliseconds",
        max_buffer_size: "Maximum output buffer size in bytes",
      });
    });

    it("should include plugin schema as JSON Schema", () => {
      const schema = getConfigSchema(registry);

      const tradingSchema = schema.plugins.trading.schema;
      expect(tradingSchema.type).toBe("object");
      expect(tradingSchema.properties).toBeDefined();
    });

    it("should be fully JSON-serializable", () => {
      const schema = getConfigSchema(registry);
      const json = JSON.stringify(schema);
      expect(json).toBeTruthy();

      const parsed = JSON.parse(json);
      expect(parsed.core.type).toBe("object");
      expect(parsed.plugins.shell.pluginName).toBe("Shell Commands");
      expect(parsed.plugins.trading.pluginName).toBe("Trading");
    });
  });
});
