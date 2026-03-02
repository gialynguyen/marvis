import { type AgentTool, BasePlugin, type PluginManifest, type PluginManager } from "@marvis/core";
import { Type } from "@sinclair/typebox";
import {
  listAllPlugins,
  listLoadedPlugins,
  getPluginInfo,
  loadPlugin,
  unloadPlugin,
  reloadPlugin,
  getPluginHealth,
} from "./tools";

/**
 * Builtin plugin that provides tools to manage the plugin lifecycle at runtime.
 *
 * Allows the LLM agent to list, load, unload, reload, and inspect plugins
 * without requiring a daemon restart.
 */
export class PluginManagerPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "plugin-manager",
    name: "Plugin Manager",
    version: "1.0.0",
    description: "Manage plugin lifecycle: load, unload, inspect plugins at runtime",
    capabilities: ["plugin_management"],
  };

  private pluginManager!: PluginManager;
  private refreshCallback?: () => void;

  /** Plugin IDs that cannot be unloaded or reloaded (system-critical) */
  private static PROTECTED_PLUGINS = ["plugin-manager", "config"];

  constructor(pluginManager: PluginManager) {
    super();
    this.pluginManager = pluginManager;
  }

  /**
   * Set a callback that refreshes the agent's tool set after loading/unloading plugins.
   * Called by the daemon after initialization to wire up the MarvisAgent.
   */
  setRefreshCallback(cb: () => void): void {
    this.refreshCallback = cb;
  }

  protected async onInitialize(): Promise<void> {
    this.logger.info("Plugin Manager plugin initialized");
  }

  protected async onShutdown(): Promise<void> {
    this.logger.info("Plugin Manager plugin shut down");
  }

  getTools(): AgentTool[] {
    return [
      // 1. list_all_plugins
      {
        name: "list_all_plugins",
        description:
          "List ALL known plugins — both loaded (active) and available (registered but not yet loaded). " +
          "Shows each plugin's status, version, mode, and capabilities.",
        dangerLevel: "safe",
        parameters: Type.Object({}),
        execute: async () => {
          const plugins = listAllPlugins(this.pluginManager);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(plugins, null, 2),
              },
            ],
          };
        },
      },

      // 2. list_loaded_plugins
      {
        name: "list_loaded_plugins",
        description:
          "List only currently loaded (active) plugins with their mode, version, and capabilities.",
        dangerLevel: "safe",
        parameters: Type.Object({}),
        execute: async () => {
          const plugins = listLoadedPlugins(this.pluginManager);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(plugins, null, 2),
              },
            ],
          };
        },
      },

      // 3. get_plugin_info
      {
        name: "get_plugin_info",
        description:
          "Get detailed information about a specific plugin including its manifest, status (loaded/available), " +
          "mode, and capabilities. Works for both loaded and available plugins.",
        dangerLevel: "safe",
        parameters: Type.Object({
          pluginId: Type.String({
            description: "Plugin ID (e.g. 'shell', 'trading', 'config')",
          }),
        }),
        execute: async (params: { pluginId: string }) => {
          try {
            const result = getPluginInfo(this.pluginManager, params.pluginId);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        },
      },

      // 4. load_plugin
      {
        name: "load_plugin",
        description:
          "Load an available (registered but not yet loaded) plugin at runtime. " +
          "The plugin will be initialized and its tools will become available immediately. " +
          "Use `list_all_plugins` first to see which plugins are available to load.",
        dangerLevel: "moderate",
        parameters: Type.Object({
          pluginId: Type.String({
            description: "Plugin ID to load (e.g. 'trading', 'shell')",
          }),
        }),
        execute: async (params: { pluginId: string }) => {
          try {
            const info = await loadPlugin(this.pluginManager, params.pluginId);
            this.refreshCallback?.();
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Plugin "${params.pluginId}" loaded successfully.\n\n${JSON.stringify(info, null, 2)}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        },
      },

      // 5. unload_plugin
      {
        name: "unload_plugin",
        description:
          "Unload a currently loaded plugin. The plugin will be shut down and its tools removed. " +
          "The plugin remains available and can be loaded again later. " +
          "Some system-critical plugins (plugin-manager, config) cannot be unloaded.",
        dangerLevel: "moderate",
        parameters: Type.Object({
          pluginId: Type.String({
            description: "Plugin ID to unload (e.g. 'trading', 'shell')",
          }),
        }),
        execute: async (params: { pluginId: string }) => {
          try {
            await unloadPlugin(
              this.pluginManager,
              params.pluginId,
              PluginManagerPlugin.PROTECTED_PLUGINS,
            );
            this.refreshCallback?.();
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Plugin "${params.pluginId}" unloaded successfully. It is now available for re-loading.`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        },
      },

      // 6. reload_plugin
      {
        name: "reload_plugin",
        description:
          "Reload a currently loaded plugin by shutting it down and re-initializing it. " +
          "Useful after configuration changes. The plugin's tools are refreshed automatically. " +
          "Some system-critical plugins (plugin-manager, config) cannot be reloaded.",
        dangerLevel: "moderate",
        parameters: Type.Object({
          pluginId: Type.String({
            description: "Plugin ID to reload (e.g. 'trading', 'shell')",
          }),
        }),
        execute: async (params: { pluginId: string }) => {
          try {
            const info = await reloadPlugin(
              this.pluginManager,
              params.pluginId,
              PluginManagerPlugin.PROTECTED_PLUGINS,
            );
            this.refreshCallback?.();
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Plugin "${params.pluginId}" reloaded successfully.\n\n${JSON.stringify(info, null, 2)}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        },
      },

      // 7. get_plugin_health
      {
        name: "get_plugin_health",
        description:
          "Run a health check on a loaded plugin. Returns whether the plugin is healthy and any diagnostic message.",
        dangerLevel: "safe",
        parameters: Type.Object({
          pluginId: Type.String({
            description: "Plugin ID to health-check (e.g. 'shell', 'trading')",
          }),
        }),
        execute: async (params: { pluginId: string }) => {
          try {
            const result = await getPluginHealth(this.pluginManager, params.pluginId);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        },
      },
    ];
  }

  getSystemPromptFragment(): string {
    return `## Plugin Manager
You can manage plugins at runtime — loading, unloading, and inspecting them without restarting the daemon.
- Use \`list_all_plugins\` to see all known plugins (both loaded and available)
- Use \`list_loaded_plugins\` to see only currently active plugins
- Use \`get_plugin_info\` to inspect a specific plugin's details
- Use \`load_plugin\` to load an available plugin on demand
- Use \`unload_plugin\` to shut down and unload a plugin (it stays available for re-loading)
- Use \`reload_plugin\` to restart a plugin (useful after config changes)
- Use \`get_plugin_health\` to run a health check on a loaded plugin
- System-critical plugins (plugin-manager, config) cannot be unloaded or reloaded`;
  }
}
