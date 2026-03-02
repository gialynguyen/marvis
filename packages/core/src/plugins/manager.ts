import type { Plugin, AgentTool, Agent } from "./plugin";
import { createLogger, type Logger } from "../daemon/logger";

export type PluginStatus = "loaded" | "available";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  mode: "tools" | "agent";
  capabilities: string[];
  status: PluginStatus;
}

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private availablePlugins: Map<string, { plugin: Plugin; config: Record<string, unknown> }> = new Map();
  private loadOrder: string[] = [];
  private logger: Logger;

  constructor() {
    this.logger = createLogger("plugin-manager");
  }

  /**
   * Register a plugin as available (but not loaded).
   * The plugin can be loaded later via `loadRegisteredPlugin()`.
   */
  registerAvailable(plugin: Plugin, config: Record<string, unknown> = {}): void {
    const { id } = plugin.manifest;
    if (this.plugins.has(id)) {
      throw new Error(`Plugin ${id} is already loaded`);
    }
    if (this.availablePlugins.has(id)) {
      throw new Error(`Plugin ${id} is already registered as available`);
    }
    this.availablePlugins.set(id, { plugin, config });
    this.logger.info(`Registered available plugin: ${id} v${plugin.manifest.version}`);
  }

  /**
   * Load a previously registered (available) plugin by its ID.
   * Moves the plugin from the available registry into the loaded set.
   */
  async loadRegisteredPlugin(id: string): Promise<void> {
    const entry = this.availablePlugins.get(id);
    if (!entry) {
      throw new Error(`Plugin ${id} is not registered as available`);
    }
    // Remove from available before loading (loadPlugin checks for duplicates)
    this.availablePlugins.delete(id);
    try {
      await this.loadPlugin(entry.plugin, entry.config);
    } catch (err) {
      // If loading fails, put it back in available
      this.availablePlugins.set(id, entry);
      throw err;
    }
  }

  async loadPlugin(plugin: Plugin, config: Record<string, unknown> = {}): Promise<void> {
    const { id } = plugin.manifest;

    if (this.plugins.has(id)) {
      throw new Error(`Plugin ${id} is already loaded`);
    }

    // Check dependencies
    if (plugin.manifest.dependencies) {
      for (const dep of plugin.manifest.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin ${id} requires ${dep} which is not loaded`);
        }
      }
    }

    // Initialize plugin
    await plugin.initialize(config);
    this.plugins.set(id, plugin);
    this.loadOrder.push(id);

    this.logger.info(`Loaded plugin: ${id} v${plugin.manifest.version}`);
  }

  async unloadPlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin ${id} not found`);
    }

    // Check if other plugins depend on this one
    for (const [otherId, otherPlugin] of this.plugins) {
      if (otherPlugin.manifest.dependencies?.includes(id)) {
        throw new Error(`Cannot unload ${id}: ${otherId} depends on it`);
      }
    }

    await plugin.shutdown();
    this.plugins.delete(id);
    this.loadOrder = this.loadOrder.filter((i) => i !== id);

    this.logger.info(`Unloaded plugin: ${id}`);
  }

  /**
   * Unload a plugin and move it back to the available registry so it can be
   * loaded again later.
   */
  async unloadToAvailable(id: string, config?: Record<string, unknown>): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin ${id} not found`);
    }

    // Check if other plugins depend on this one
    for (const [otherId, otherPlugin] of this.plugins) {
      if (otherPlugin.manifest.dependencies?.includes(id)) {
        throw new Error(`Cannot unload ${id}: ${otherId} depends on it`);
      }
    }

    await plugin.shutdown();
    this.plugins.delete(id);
    this.loadOrder = this.loadOrder.filter((i) => i !== id);

    // Move back to available registry
    this.availablePlugins.set(id, { plugin, config: config ?? {} });

    this.logger.info(`Unloaded plugin ${id} (moved to available)`);
  }

  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  /** Check if a plugin is currently loaded */
  isLoaded(id: string): boolean {
    return this.plugins.has(id);
  }

  /** Check if a plugin is registered as available (but not loaded) */
  isAvailable(id: string): boolean {
    return this.availablePlugins.has(id);
  }

  /** List currently loaded plugins */
  getLoadedPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      mode: p.mode,
      capabilities: p.manifest.capabilities,
      status: "loaded" as PluginStatus,
    }));
  }

  /** List available (registered but not loaded) plugins */
  getAvailablePlugins(): PluginInfo[] {
    return Array.from(this.availablePlugins.values()).map(({ plugin }) => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      mode: plugin.mode,
      capabilities: plugin.manifest.capabilities,
      status: "available" as PluginStatus,
    }));
  }

  /** List all plugins (both loaded and available) */
  getAllPlugins(): PluginInfo[] {
    return [...this.getLoadedPlugins(), ...this.getAvailablePlugins()];
  }

  /** @deprecated Use getLoadedPlugins() instead */
  listPlugins(): PluginInfo[] {
    return this.getLoadedPlugins();
  }

  getAllTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.mode === "tools") {
        tools.push(...plugin.getTools());
      }
    }
    return tools;
  }

  getActiveAgents(): Map<string, Agent> {
    const agents = new Map<string, Agent>();
    for (const [id, plugin] of this.plugins) {
      if (plugin.mode === "agent") {
        const agent = plugin.getAgent?.();
        if (agent) {
          agents.set(id, agent);
        }
      }
    }
    return agents;
  }

  getSystemPromptFragments(): string {
    return Array.from(this.plugins.values())
      .map((p) => p.getSystemPromptFragment())
      .join("\n\n");
  }

  async promotePlugin(id: string, agent: Agent): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin ${id} not found`);
    }

    plugin.promoteToAgent(agent);
    this.logger.info(`Promoted plugin ${id} to agent mode`);
  }

  async demotePlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin ${id} not found`);
    }

    plugin.demoteToTools();
    this.logger.info(`Demoted plugin ${id} to tools mode`);
  }

  async shutdownAll(): Promise<void> {
    const errors: Array<{ id: string; error: Error }> = [];
    // Shutdown in reverse load order
    for (const id of [...this.loadOrder].reverse()) {
      const plugin = this.plugins.get(id);
      if (plugin) {
        try {
          await plugin.shutdown();
        } catch (err) {
          this.logger.error(`Failed to shutdown plugin ${id}: ${err}`);
          errors.push({
            id,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
        this.plugins.delete(id);
      }
    }
    this.loadOrder = [];
    this.availablePlugins.clear();
    this.logger.info("All plugins shut down");
    if (errors.length > 0) {
      throw new Error(
        `Failed to shutdown ${errors.length} plugin(s): ${errors.map((e) => e.id).join(", ")}`,
      );
    }
  }
}
