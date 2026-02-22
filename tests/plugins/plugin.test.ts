import { describe, it, expect, vi } from "vitest";
import { BasePlugin, type Plugin, type PluginManifest } from "../../src/plugins/plugin.js";

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
});
