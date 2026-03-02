import { describe, it, expect, beforeEach } from "vitest";
import { PluginManager } from "../../src/plugins/manager";
import {
  BasePlugin,
  type PluginManifest,
  type AgentTool,
} from "../../src/plugins/plugin";

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

class AnotherPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "another",
    name: "Another Plugin",
    version: "2.0.0",
    description: "Another mock plugin",
    capabilities: ["another"],
  };

  protected async onInitialize(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
  getTools(): AgentTool[] {
    return [];
  }
  getSystemPromptFragment(): string {
    return "";
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

  // ============= Available / Registered Plugin Tests =============

  describe("registerAvailable", () => {
    it("should register a plugin as available", () => {
      const plugin = new MockPlugin();
      manager.registerAvailable(plugin, { key: "val" });

      expect(manager.isAvailable("mock")).toBe(true);
      expect(manager.isLoaded("mock")).toBe(false);
    });

    it("should throw when registering a plugin that is already loaded", async () => {
      const plugin = new MockPlugin();
      await manager.loadPlugin(plugin);

      expect(() => manager.registerAvailable(plugin)).toThrow("already loaded");
    });

    it("should throw when registering a plugin that is already available", () => {
      const plugin = new MockPlugin();
      manager.registerAvailable(plugin);

      const anotherRef = new MockPlugin();
      expect(() => manager.registerAvailable(anotherRef)).toThrow("already registered");
    });
  });

  describe("loadRegisteredPlugin", () => {
    it("should load an available plugin", async () => {
      const plugin = new MockPlugin();
      manager.registerAvailable(plugin, { key: "val" });

      await manager.loadRegisteredPlugin("mock");

      expect(manager.isLoaded("mock")).toBe(true);
      expect(manager.isAvailable("mock")).toBe(false);
    });

    it("should throw when trying to load a non-available plugin", async () => {
      await expect(manager.loadRegisteredPlugin("nonexistent")).rejects.toThrow(
        "not registered as available",
      );
    });

    it("should put plugin back to available if loading fails", async () => {
      // Create a plugin with unsatisfied dependencies
      class DepPlugin extends BasePlugin {
        manifest: PluginManifest = {
          id: "dep",
          name: "Dep Plugin",
          version: "1.0.0",
          description: "Plugin with deps",
          capabilities: [],
          dependencies: ["nonexistent"],
        };
        protected async onInitialize() {}
        protected async onShutdown() {}
        getTools() { return []; }
        getSystemPromptFragment() { return ""; }
      }

      const plugin = new DepPlugin();
      manager.registerAvailable(plugin);

      await expect(manager.loadRegisteredPlugin("dep")).rejects.toThrow("nonexistent");
      // Should still be available
      expect(manager.isAvailable("dep")).toBe(true);
      expect(manager.isLoaded("dep")).toBe(false);
    });
  });

  describe("unloadToAvailable", () => {
    it("should unload a plugin and move it to available", async () => {
      const plugin = new MockPlugin();
      await manager.loadPlugin(plugin);

      await manager.unloadToAvailable("mock", { key: "val" });

      expect(manager.isLoaded("mock")).toBe(false);
      expect(manager.isAvailable("mock")).toBe(true);
    });

    it("should throw when unloading a non-loaded plugin", async () => {
      await expect(manager.unloadToAvailable("nonexistent")).rejects.toThrow("not found");
    });

    it("should prevent unloading if other plugins depend on it", async () => {
      class DepPlugin extends BasePlugin {
        manifest: PluginManifest = {
          id: "dep",
          name: "Dep Plugin",
          version: "1.0.0",
          description: "Plugin with deps",
          capabilities: [],
          dependencies: ["mock"],
        };
        protected async onInitialize() {}
        protected async onShutdown() {}
        getTools() { return []; }
        getSystemPromptFragment() { return ""; }
      }

      const mockPlugin = new MockPlugin();
      await manager.loadPlugin(mockPlugin);

      const depPlugin = new DepPlugin();
      await manager.loadPlugin(depPlugin);

      await expect(manager.unloadToAvailable("mock")).rejects.toThrow("depends on it");
    });
  });

  describe("getAllPlugins / getLoadedPlugins / getAvailablePlugins", () => {
    it("should return loaded plugins", async () => {
      const plugin = new MockPlugin();
      await manager.loadPlugin(plugin);

      const loaded = manager.getLoadedPlugins();
      expect(loaded.length).toBe(1);
      expect(loaded[0].id).toBe("mock");
      expect(loaded[0].status).toBe("loaded");
    });

    it("should return available plugins", () => {
      const plugin = new MockPlugin();
      manager.registerAvailable(plugin);

      const available = manager.getAvailablePlugins();
      expect(available.length).toBe(1);
      expect(available[0].id).toBe("mock");
      expect(available[0].status).toBe("available");
    });

    it("should return all plugins (loaded + available)", async () => {
      const mockPlugin = new MockPlugin();
      await manager.loadPlugin(mockPlugin);

      const anotherPlugin = new AnotherPlugin();
      manager.registerAvailable(anotherPlugin);

      const all = manager.getAllPlugins();
      expect(all.length).toBe(2);
      expect(all.map((p) => p.id).sort()).toEqual(["another", "mock"]);
    });

    it("should include description in plugin info", async () => {
      const plugin = new MockPlugin();
      await manager.loadPlugin(plugin);

      const loaded = manager.getLoadedPlugins();
      expect(loaded[0].description).toBe("A mock plugin for testing");
    });
  });

  describe("shutdownAll clears available plugins too", () => {
    it("should clear both loaded and available plugins on shutdown", async () => {
      const mockPlugin = new MockPlugin();
      await manager.loadPlugin(mockPlugin);

      const anotherPlugin = new AnotherPlugin();
      manager.registerAvailable(anotherPlugin);

      await manager.shutdownAll();

      expect(manager.getLoadedPlugins().length).toBe(0);
      expect(manager.getAvailablePlugins().length).toBe(0);
      expect(manager.getAllPlugins().length).toBe(0);
    });
  });
});
