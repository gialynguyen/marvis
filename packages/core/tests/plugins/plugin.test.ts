import { describe, it, expect, vi } from "vitest";
import {
  BasePlugin,
  type Plugin,
  type PluginManifest,
  type PluginConfigDescriptor,
} from "../../src/plugins/plugin";
import { Type } from "@sinclair/typebox";

class TestPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "test",
    name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    capabilities: ["test"],
  };

  protected async onInitialize(): Promise<void> {
    // Test initialization
  }

  protected async onShutdown(): Promise<void> {
    // Test shutdown
  }

  getTools() {
    return [
      {
        name: "test_tool",
        description: "A test tool",
        parameters: {},
        execute: async () => "test result",
      },
    ];
  }

  getSystemPromptFragment(): string {
    return "## Test Plugin\nThis is a test.";
  }
}

describe("BasePlugin", () => {
  it("should initialize with config", async () => {
    const plugin = new TestPlugin();
    await plugin.initialize({ key: "value" });

    expect(plugin.manifest.id).toBe("test");
    expect(plugin.mode).toBe("tools");
  });

  it("should return tools", () => {
    const plugin = new TestPlugin();
    const tools = plugin.getTools();

    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("test_tool");
  });

  it("should return system prompt fragment", () => {
    const plugin = new TestPlugin();
    const fragment = plugin.getSystemPromptFragment();

    expect(fragment).toContain("Test Plugin");
  });

  it("should perform health check", async () => {
    const plugin = new TestPlugin();
    const health = await plugin.healthCheck();

    expect(health.healthy).toBe(true);
  });

  it("should return undefined for getAgent by default", () => {
    const plugin = new TestPlugin();
    expect(plugin.getAgent()).toBeUndefined();
  });

  it("should have danger level on tools", () => {
    const tool = {
      name: "test",
      description: "Test tool",
      dangerLevel: "dangerous" as const,
      parameters: {},
      execute: async () => ({}),
    };
    expect(tool.dangerLevel).toBe("dangerous");
  });
});

// --- onConfigChange tests ---

class ConfigAwarePlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "config-aware",
    name: "Config Aware Plugin",
    version: "1.0.0",
    description: "Plugin with configDescriptor",
    capabilities: ["test"],
  };

  configDescriptor: PluginConfigDescriptor = {
    schema: Type.Object({
      host: Type.String(),
      port: Type.Number(),
      debug: Type.Optional(Type.Boolean()),
    }),
    defaults: { host: "localhost", port: 3000, debug: false },
  };

  /** Expose protected config for test assertions */
  getConfig() {
    return this.config;
  }

  protected async onInitialize(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
  getTools() {
    return [];
  }
  getSystemPromptFragment() {
    return "";
  }
}

class SimplePlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "simple",
    name: "Simple Plugin",
    version: "1.0.0",
    description: "Plugin without configDescriptor",
    capabilities: ["test"],
  };

  /** Expose protected config for test assertions */
  getConfig() {
    return this.config;
  }

  protected async onInitialize(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
  getTools() {
    return [];
  }
  getSystemPromptFragment() {
    return "";
  }
}

describe("onConfigChange", () => {
  it("should update config with new values (default behavior)", async () => {
    const plugin = new ConfigAwarePlugin();
    await plugin.initialize({ host: "example.com", port: 8080 });

    await plugin.onConfigChange({ host: "new-host.com", port: 9090 });

    expect(plugin.getConfig()).toEqual({
      host: "new-host.com",
      port: 9090,
      debug: false,
    });
  });

  it("should validate new config against schema and merge with defaults", async () => {
    const plugin = new ConfigAwarePlugin();
    await plugin.initialize({ host: "example.com", port: 8080 });

    // Only provide host and port; debug should come from defaults
    await plugin.onConfigChange({ host: "updated.com", port: 4000 });

    const config = plugin.getConfig();
    expect(config).toEqual({
      host: "updated.com",
      port: 4000,
      debug: false,
    });
  });

  it("should throw Error if new config is invalid against schema", async () => {
    const plugin = new ConfigAwarePlugin();
    await plugin.initialize({ host: "example.com", port: 8080 });

    // port should be a number, not a string
    await expect(
      plugin.onConfigChange({ host: "valid-host", port: "not-a-number" as any }),
    ).rejects.toThrow(/Invalid config for plugin "config-aware"/);
  });

  it("should simply replace config when no configDescriptor is defined", async () => {
    const plugin = new SimplePlugin();
    await plugin.initialize({ alpha: 1, beta: "two" });

    const newConfig = { gamma: true, delta: [1, 2, 3] };
    await plugin.onConfigChange(newConfig);

    expect(plugin.getConfig()).toEqual(newConfig);
  });

  it("should reflect new values in internal config after onConfigChange", async () => {
    const plugin = new ConfigAwarePlugin();
    await plugin.initialize({ host: "initial.com", port: 1000 });

    expect(plugin.getConfig()).toEqual({
      host: "initial.com",
      port: 1000,
      debug: false,
    });

    await plugin.onConfigChange({ host: "changed.com", port: 2000, debug: true });

    expect(plugin.getConfig()).toEqual({
      host: "changed.com",
      port: 2000,
      debug: true,
    });
  });
});
