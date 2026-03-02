import { describe, it, expect, beforeEach } from "vitest";
import { PluginManager } from "@marvis/core";
import {
  BasePlugin,
  type PluginManifest,
  type AgentTool,
} from "@marvis/core";
import {
  listAllPlugins,
  listLoadedPlugins,
  getPluginInfo,
  loadPlugin,
  unloadPlugin,
  reloadPlugin,
  getPluginHealth,
} from "../src/tools";

class MockPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "mock",
    name: "Mock Plugin",
    version: "1.0.0",
    description: "A mock plugin for testing",
    capabilities: ["mock"],
  };

  initCount = 0;
  shutdownCount = 0;

  protected async onInitialize(): Promise<void> {
    this.initCount++;
  }
  protected async onShutdown(): Promise<void> {
    this.shutdownCount++;
  }

  getTools(): AgentTool[] {
    return [
      {
        name: "mock_tool",
        description: "A mock tool",
        parameters: {},
        execute: async () => ({ content: [{ type: "text", text: "mock" }] }),
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
    description: "Another plugin",
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

describe("Plugin Manager Tools", () => {
  let manager: PluginManager;
  let mockPlugin: MockPlugin;
  let anotherPlugin: AnotherPlugin;

  beforeEach(async () => {
    manager = new PluginManager();
    mockPlugin = new MockPlugin();
    anotherPlugin = new AnotherPlugin();
  });

  describe("listAllPlugins", () => {
    it("should list both loaded and available plugins", async () => {
      await manager.loadPlugin(mockPlugin);
      manager.registerAvailable(anotherPlugin);

      const all = listAllPlugins(manager);
      expect(all.length).toBe(2);

      const ids = all.map((p) => p.id).sort();
      expect(ids).toEqual(["another", "mock"]);

      const loaded = all.find((p) => p.id === "mock");
      expect(loaded?.status).toBe("loaded");

      const available = all.find((p) => p.id === "another");
      expect(available?.status).toBe("available");
    });

    it("should return empty array when no plugins registered", () => {
      expect(listAllPlugins(manager)).toEqual([]);
    });
  });

  describe("listLoadedPlugins", () => {
    it("should list only loaded plugins", async () => {
      await manager.loadPlugin(mockPlugin);
      manager.registerAvailable(anotherPlugin);

      const loaded = listLoadedPlugins(manager);
      expect(loaded.length).toBe(1);
      expect(loaded[0].id).toBe("mock");
      expect(loaded[0].status).toBe("loaded");
    });
  });

  describe("getPluginInfo", () => {
    it("should get info for a loaded plugin", async () => {
      await manager.loadPlugin(mockPlugin);

      const result = getPluginInfo(manager, "mock");
      expect(result.info.id).toBe("mock");
      expect(result.info.status).toBe("loaded");
    });

    it("should get info for an available plugin", () => {
      manager.registerAvailable(mockPlugin);

      const result = getPluginInfo(manager, "mock");
      expect(result.info.id).toBe("mock");
      expect(result.info.status).toBe("available");
    });

    it("should throw for unknown plugin", () => {
      expect(() => getPluginInfo(manager, "nonexistent")).toThrow("not found");
    });
  });

  describe("loadPlugin", () => {
    it("should load an available plugin", async () => {
      manager.registerAvailable(mockPlugin);

      const info = await loadPlugin(manager, "mock");
      expect(info.status).toBe("loaded");
      expect(info.id).toBe("mock");
      expect(manager.isLoaded("mock")).toBe(true);
      expect(manager.isAvailable("mock")).toBe(false);
    });

    it("should throw if plugin is already loaded", async () => {
      await manager.loadPlugin(mockPlugin);

      await expect(loadPlugin(manager, "mock")).rejects.toThrow("already loaded");
    });

    it("should throw if plugin is not available", async () => {
      await expect(loadPlugin(manager, "nonexistent")).rejects.toThrow("not available");
    });
  });

  describe("unloadPlugin", () => {
    it("should unload a loaded plugin to available", async () => {
      await manager.loadPlugin(mockPlugin);

      await unloadPlugin(manager, "mock");
      expect(manager.isLoaded("mock")).toBe(false);
      expect(manager.isAvailable("mock")).toBe(true);
    });

    it("should throw if plugin is not loaded", async () => {
      await expect(unloadPlugin(manager, "nonexistent")).rejects.toThrow("not loaded");
    });

    it("should throw if plugin is protected", async () => {
      await manager.loadPlugin(mockPlugin);

      await expect(
        unloadPlugin(manager, "mock", ["mock"]),
      ).rejects.toThrow("protected plugin");
    });
  });

  describe("reloadPlugin", () => {
    it("should reload a loaded plugin", async () => {
      await manager.loadPlugin(mockPlugin);

      const info = await reloadPlugin(manager, "mock");
      expect(info.status).toBe("loaded");
      expect(info.id).toBe("mock");
    });

    it("should throw if plugin is not loaded", async () => {
      await expect(reloadPlugin(manager, "nonexistent")).rejects.toThrow("not loaded");
    });

    it("should throw if plugin is protected", async () => {
      await manager.loadPlugin(mockPlugin);

      await expect(
        reloadPlugin(manager, "mock", ["mock"]),
      ).rejects.toThrow("protected plugin");
    });
  });

  describe("getPluginHealth", () => {
    it("should return health check for loaded plugin", async () => {
      await manager.loadPlugin(mockPlugin);

      const result = await getPluginHealth(manager, "mock");
      expect(result.pluginId).toBe("mock");
      expect(result.healthy).toBe(true);
    });

    it("should throw if plugin is not loaded", async () => {
      await expect(getPluginHealth(manager, "nonexistent")).rejects.toThrow("not loaded");
    });
  });
});
