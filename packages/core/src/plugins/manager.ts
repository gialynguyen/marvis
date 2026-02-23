import type { Plugin, AgentTool, Agent } from "./plugin";
import { createLogger, type Logger } from "../daemon/logger";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  mode: "tools" | "agent";
  capabilities: string[];
}

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private loadOrder: string[] = [];
  private logger: Logger;

  constructor() {
    this.logger = createLogger("plugin-manager");
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

  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  listPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      mode: p.mode,
      capabilities: p.manifest.capabilities,
    }));
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
    this.logger.info("All plugins shut down");
    if (errors.length > 0) {
      throw new Error(
        `Failed to shutdown ${errors.length} plugin(s): ${errors.map((e) => e.id).join(", ")}`,
      );
    }
  }
}
