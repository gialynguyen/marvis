import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfigReloadManager } from "../../src/daemon/config-reload-manager";
import { DEFAULT_CONFIG, type MarvisConfig } from "@marvis/config";

// Helper to create a deep clone of DEFAULT_CONFIG
function makeConfig(overrides: Partial<Record<string, unknown>> = {}): MarvisConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  for (const [key, value] of Object.entries(overrides)) {
    (config as any)[key] = value;
  }
  return config;
}

function createMockAgent() {
  return {
    updateConfig: vi.fn(),
    setModel: vi.fn(),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    close: vi.fn(),
  };
}

function createMockPluginManager() {
  return {
    getPlugin: vi.fn(),
    getAllTools: vi.fn().mockReturnValue([]),
    listPlugins: vi.fn().mockReturnValue([]),
    getActiveAgents: vi.fn().mockReturnValue(new Map()),
    getSystemPromptFragments: vi.fn().mockReturnValue(""),
  };
}

describe("ConfigReloadManager", () => {
  let currentConfig: MarvisConfig;
  let loadConfigFn: ReturnType<typeof vi.fn>;
  let mockAgent: ReturnType<typeof createMockAgent>;
  let mockPluginManager: ReturnType<typeof createMockPluginManager>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let reloadManager: ConfigReloadManager;

  beforeEach(() => {
    currentConfig = makeConfig();
    loadConfigFn = vi.fn();
    mockAgent = createMockAgent();
    mockPluginManager = createMockPluginManager();
    mockLogger = createMockLogger();

    reloadManager = new ConfigReloadManager(
      loadConfigFn,
      () => currentConfig,
      (newConfig) => { currentConfig = newConfig; },
      mockPluginManager as any,
      mockAgent as any,
      mockLogger as any,
    );
  });

  describe("core config changes", () => {
    it("should apply LLM provider/model change", async () => {
      const newConfig = makeConfig();
      newConfig.llm.provider = "openai";
      newConfig.llm.model = "gpt-4o";
      loadConfigFn.mockReturnValue(newConfig);

      const result = await reloadManager.reload();

      expect(mockAgent.updateConfig).toHaveBeenCalledWith({
        provider: "openai",
        model: "gpt-4o",
      });
      expect(result.applied).toContain("llm (openai/gpt-4o)");
      expect(result.errors).toEqual([]);
    });

    it("should apply system prompt change", async () => {
      const newConfig = makeConfig();
      newConfig.system.systemPrompt = "New system prompt";
      loadConfigFn.mockReturnValue(newConfig);

      const result = await reloadManager.reload();

      expect(mockAgent.updateConfig).toHaveBeenCalledWith({
        systemPrompt: "New system prompt",
      });
      expect(result.applied).toContain("system.systemPrompt");
    });

    it("should apply tools section change", async () => {
      const newConfig = makeConfig();
      newConfig.tools.confirmDangerous = false;
      newConfig.tools.dangerThreshold = "moderate";
      loadConfigFn.mockReturnValue(newConfig);

      const result = await reloadManager.reload();

      expect(mockAgent.updateConfig).toHaveBeenCalledWith({
        confirmDangerousTools: false,
        dangerThreshold: "moderate",
      });
      expect(result.applied).toContain("tools");
    });

    it("should apply logging level change", async () => {
      const newConfig = makeConfig();
      newConfig.logging.level = "debug";
      loadConfigFn.mockReturnValue(newConfig);

      const result = await reloadManager.reload();

      expect(result.applied).toContain("logging.level (debug)");
    });

    it("should apply apiKey change", async () => {
      const newConfig = makeConfig();
      newConfig.llm.apiKey = "sk-new-key";
      loadConfigFn.mockReturnValue(newConfig);

      const result = await reloadManager.reload();

      expect(mockAgent.updateConfig).toHaveBeenCalledWith({ apiKey: "sk-new-key" });
      expect(result.applied).toContain("llm.apiKey");
    });

    it("should update stored config after reload", async () => {
      const newConfig = makeConfig();
      newConfig.llm.model = "gpt-4o";
      loadConfigFn.mockReturnValue(newConfig);

      await reloadManager.reload();

      expect(currentConfig.llm.model).toBe("gpt-4o");
    });
  });

  describe("plugin notification", () => {
    it("should notify plugin when its config changes", async () => {
      const mockPlugin = {
        onConfigChange: vi.fn(),
        manifest: { id: "shell" },
      };
      mockPluginManager.getPlugin.mockImplementation((id: string) =>
        id === "shell" ? mockPlugin : undefined,
      );

      const newConfig = makeConfig();
      newConfig.plugins = { shell: { default_timeout: 5000 } };
      loadConfigFn.mockReturnValue(newConfig);

      const result = await reloadManager.reload();

      expect(mockPlugin.onConfigChange).toHaveBeenCalledWith({ default_timeout: 5000 });
      expect(result.applied).toContain("plugin.shell");
    });

    it("should NOT notify plugin when its config is unchanged", async () => {
      const mockPlugin = {
        onConfigChange: vi.fn(),
        manifest: { id: "shell" },
      };
      mockPluginManager.getPlugin.mockReturnValue(mockPlugin);

      // Same config as current (both empty plugins)
      const newConfig = makeConfig();
      loadConfigFn.mockReturnValue(newConfig);

      const result = await reloadManager.reload();

      expect(mockPlugin.onConfigChange).not.toHaveBeenCalled();
    });

    it("should handle plugin onConfigChange throwing error", async () => {
      const failPlugin = {
        onConfigChange: vi.fn().mockRejectedValue(new Error("Plugin error")),
        manifest: { id: "failing" },
      };
      const goodPlugin = {
        onConfigChange: vi.fn(),
        manifest: { id: "good" },
      };
      mockPluginManager.getPlugin.mockImplementation((id: string) => {
        if (id === "failing") return failPlugin;
        if (id === "good") return goodPlugin;
        return undefined;
      });

      // Set current config with both plugins
      currentConfig.plugins = { failing: { x: 1 }, good: { y: 1 } };

      const newConfig = makeConfig();
      newConfig.plugins = { failing: { x: 2 }, good: { y: 2 } };
      loadConfigFn.mockReturnValue(newConfig);

      const result = await reloadManager.reload();

      // Failing plugin error captured
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("failing");

      // Good plugin still notified
      expect(goodPlugin.onConfigChange).toHaveBeenCalledWith({ y: 2 });
      expect(result.applied).toContain("plugin.good");
    });

    it("should skip plugins not loaded in plugin manager", async () => {
      mockPluginManager.getPlugin.mockReturnValue(undefined);

      const newConfig = makeConfig();
      newConfig.plugins = { unknown_plugin: { key: "value" } };
      loadConfigFn.mockReturnValue(newConfig);

      const result = await reloadManager.reload();

      // Should not fail, just skip
      expect(result.errors).toEqual([]);
    });

    it("should skip plugins without onConfigChange method", async () => {
      const pluginWithoutHook = {
        manifest: { id: "nohook" },
        // no onConfigChange
      };
      mockPluginManager.getPlugin.mockReturnValue(pluginWithoutHook);

      currentConfig.plugins = { nohook: { a: 1 } };

      const newConfig = makeConfig();
      newConfig.plugins = { nohook: { a: 2 } };
      loadConfigFn.mockReturnValue(newConfig);

      const result = await reloadManager.reload();

      // Should still count it as applied
      expect(result.applied).toContain("plugin.nohook");
      expect(result.errors).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("should return error when loadConfigFn throws", async () => {
      loadConfigFn.mockImplementation(() => {
        throw new Error("Invalid TOML syntax");
      });

      const result = await reloadManager.reload();

      expect(result.errors).toEqual([
        "Failed to parse config: Invalid TOML syntax",
      ]);
      expect(result.applied).toEqual([]);
      // Config should remain unchanged
      expect(currentConfig).toEqual(DEFAULT_CONFIG);
    });

    it("should return empty applied when no changes detected", async () => {
      loadConfigFn.mockReturnValue(makeConfig());

      const result = await reloadManager.reload();

      expect(result.applied).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  describe("concurrency", () => {
    it("should prevent concurrent reloads", async () => {
      // loadConfigFn that takes some time
      loadConfigFn.mockImplementation(() => {
        const cfg = makeConfig();
        cfg.llm.model = "new-model";
        return cfg;
      });

      // Start two reloads simultaneously
      const [result1, result2] = await Promise.all([
        reloadManager.reload(),
        reloadManager.reload(),
      ]);

      // One should succeed, one should be rejected
      const hasRealChanges = result1.applied.length > 0 || result2.applied.length > 0;
      const hasAlreadyInProgress =
        result1.errors.includes("Reload already in progress") ||
        result2.errors.includes("Reload already in progress");

      expect(hasRealChanges).toBe(true);
      expect(hasAlreadyInProgress).toBe(true);
    });
  });
});
