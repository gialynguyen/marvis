import { describe, it, expect, beforeEach } from "vitest";
import { PluginManager } from "../../src/plugins/manager.js";
import { BasePlugin, type PluginManifest, type AgentTool } from "../../src/plugins/plugin.js";

class MockPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "mock",
    name: "Mock Plugin",
    version: "1.0.0",
    description: "A mock plugin for testing",
    capabilities: ["mock"],
  };

  protected async onInitialize(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}

  getTools(): AgentTool[] {
    return [
      {
        name: "mock_tool",
        description: "A mock tool",
        parameters: {},
        execute: async () => "mock result",
      },
    ];
  }

  getSystemPromptFragment(): string {
    return "## Mock\nMock functionality.";
  }
}

describe("PluginManager", () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  it("should load a plugin", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);

    expect(manager.getPlugin("mock")).toBe(plugin);
  });

  it("should throw when loading duplicate plugin", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);

    await expect(manager.loadPlugin(plugin)).rejects.toThrow("already loaded");
  });

  it("should unload a plugin", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);
    await manager.unloadPlugin("mock");

    expect(manager.getPlugin("mock")).toBeUndefined();
  });

  it("should collect all tools from plugins in tools mode", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);

    const tools = manager.getAllTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("mock_tool");
  });

  it("should assemble system prompt fragments", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);

    const fragments = manager.getSystemPromptFragments();
    expect(fragments).toContain("Mock");
  });

  it("should list all plugins", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);

    const plugins = manager.listPlugins();
    expect(plugins.length).toBe(1);
    expect(plugins[0].id).toBe("mock");
  });

  it("should shutdown all plugins", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);
    await manager.shutdownAll();

    expect(manager.listPlugins().length).toBe(0);
  });
});
