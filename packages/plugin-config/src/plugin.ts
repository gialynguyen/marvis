import { type AgentTool, BasePlugin, type PluginManifest } from "@marvis/core";
import {
  type MarvisConfig,
  type PluginConfigRegistry,
  loadConfig,
  getConfigPath,
} from "@marvis/config";
import { Type } from "@sinclair/typebox";
import {
  getConfig,
  getConfigValue,
  setConfigValue,
  listPlugins,
  getPluginConfig,
  setPluginConfig,
  resetPluginConfig,
} from "./tools";

export class ConfigPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "config",
    name: "Configuration Manager",
    version: "1.0.0",
    description: "Inspect and modify Marvis configuration",
    capabilities: ["config_read", "config_write", "plugin_config"],
  };

  private registry: PluginConfigRegistry;
  private currentConfig!: MarvisConfig;
  private reloadCallback?: () => Promise<{ applied: string[]; errors: string[] }>;

  constructor(registry: PluginConfigRegistry) {
    super();
    this.registry = registry;
  }

  /**
   * Set a callback that triggers a full config hot-reload across the daemon.
   * Called by the daemon after initialization to wire up the reload manager.
   */
  setReloadCallback(cb: () => Promise<{ applied: string[]; errors: string[] }>): void {
    this.reloadCallback = cb;
  }

  protected async onInitialize(): Promise<void> {
    // Load current config for read operations
    this.currentConfig = loadConfig(undefined, this.registry);
    this.logger.info("Config plugin initialized");
  }

  protected async onShutdown(): Promise<void> {
    this.logger.info("Config plugin shut down");
  }

  /** Reload config from disk (call after writes) */
  private reloadConfig(): void {
    this.currentConfig = loadConfig(undefined, this.registry);
  }

  getTools(): AgentTool[] {
    return [
      // 1. get_config
      {
        name: "get_config",
        description:
          "Read the current Marvis configuration. Optionally filter by section (llm, tools, paths, logging, plugins, aliases). Sensitive fields like API keys are redacted.",
        dangerLevel: "safe",
        parameters: Type.Object({
          section: Type.Optional(
            Type.String({
              description:
                "Optional: specific section to read (llm, tools, paths, logging, plugins, aliases, system)",
            }),
          ),
        }),
        execute: async (params: { section?: string }) => {
          try {
            const result = getConfig(this.currentConfig, params.section);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        },
      },

      // 2. get_config_value
      {
        name: "get_config_value",
        description:
          "Read a specific configuration value by dot-separated path (e.g., 'llm.provider', 'plugins.trading.exchange').",
        dangerLevel: "safe",
        parameters: Type.Object({
          path: Type.String({
            description:
              "Dot-separated path to the config value, e.g. 'llm.provider' or 'plugins.trading.exchange'",
          }),
        }),
        execute: async (params: { path: string }) => {
          try {
            const value = getConfigValue(this.currentConfig, params.path);
            return {
              content: [
                {
                  type: "text",
                  text: `${params.path} = ${JSON.stringify(value, null, 2)}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        },
      },

      // 3. set_config_value
      {
        name: "set_config_value",
        description:
          "Update a configuration value by dot-separated path and persist to the TOML config file. Changes take effect on next daemon restart. Note: custom comments in the config file will be replaced.",
        dangerLevel: "moderate",
        parameters: Type.Object({
          path: Type.String({
            description: "Dot-separated path to the config value, e.g. 'llm.model'",
          }),
          value: Type.Unknown({
            description: "New value to set",
          }),
        }),
        execute: async (params: { path: string; value: unknown }) => {
          try {
            const { updatedSection, configPath } = setConfigValue(params.path, params.value);
            this.reloadConfig();

            // Trigger hot-reload across the daemon
            let reloadInfo = "";
            if (this.reloadCallback) {
              const result = await this.reloadCallback();
              if (result.applied.length > 0) {
                reloadInfo = `\n\nHot-reloaded: ${result.applied.join(", ")}`;
              }
              if (result.errors.length > 0) {
                reloadInfo += `\n\nReload warnings: ${result.errors.join("; ")}`;
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Updated ${params.path} in ${configPath}\n\nUpdated section:\n${JSON.stringify(updatedSection, null, 2)}${reloadInfo}\n\nNote: Custom comments in the config file have been replaced.`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        },
      },

      // 4. list_plugins
      {
        name: "list_config_plugins",
        description:
          "List all registered plugins that have declared configuration schemas, showing their available config fields.",
        dangerLevel: "safe",
        parameters: Type.Object({}),
        execute: async () => {
          const plugins = listPlugins(this.registry);
          if (plugins.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No plugins with configuration schemas are registered.",
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(plugins, null, 2),
              },
            ],
          };
        },
      },

      // 5. get_plugin_config
      {
        name: "get_plugin_config",
        description:
          "Get a specific plugin's current configuration, default values, and field descriptions.",
        dangerLevel: "safe",
        parameters: Type.Object({
          pluginId: Type.String({
            description: "Plugin ID (e.g. 'shell', 'trading')",
          }),
        }),
        execute: async (params: { pluginId: string }) => {
          try {
            const result = getPluginConfig(this.registry, this.currentConfig, params.pluginId);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        },
      },

      // 6. set_plugin_config
      {
        name: "set_plugin_config",
        description:
          "Update a specific plugin's configuration value and persist to the TOML config file. Validates against the plugin's declared schema.",
        dangerLevel: "moderate",
        parameters: Type.Object({
          pluginId: Type.String({
            description: "Plugin ID (e.g. 'shell', 'trading')",
          }),
          key: Type.String({
            description: "Config key to update (e.g. 'exchange', 'default_timeout')",
          }),
          value: Type.Unknown({
            description: "New value to set",
          }),
        }),
        execute: async (params: { pluginId: string; key: string; value: unknown }) => {
          try {
            const { updatedConfig, configPath } = setPluginConfig(
              this.registry,
              params.pluginId,
              params.key,
              params.value,
            );
            this.reloadConfig();

            // Trigger hot-reload across the daemon
            let reloadInfo = "";
            if (this.reloadCallback) {
              const result = await this.reloadCallback();
              if (result.applied.length > 0) {
                reloadInfo = `\n\nHot-reloaded: ${result.applied.join(", ")}`;
              }
              if (result.errors.length > 0) {
                reloadInfo += `\n\nReload warnings: ${result.errors.join("; ")}`;
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Updated plugin "${params.pluginId}" config in ${configPath}\n\nCurrent config:\n${JSON.stringify(updatedConfig, null, 2)}${reloadInfo}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        },
      },

      // 7. reset_plugin_config
      {
        name: "reset_plugin_config",
        description:
          "Reset a plugin's configuration back to its declared defaults. Can reset a single key or the entire plugin config.",
        dangerLevel: "moderate",
        parameters: Type.Object({
          pluginId: Type.String({
            description: "Plugin ID (e.g. 'shell', 'trading')",
          }),
          key: Type.Optional(
            Type.String({
              description: "Optional: reset only this key (otherwise resets all plugin config)",
            }),
          ),
        }),
        execute: async (params: { pluginId: string; key?: string }) => {
          try {
            const { updatedConfig, configPath } = resetPluginConfig(
              this.registry,
              params.pluginId,
              params.key,
            );
            this.reloadConfig();

            // Trigger hot-reload across the daemon
            let reloadInfo = "";
            if (this.reloadCallback) {
              const result = await this.reloadCallback();
              if (result.applied.length > 0) {
                reloadInfo = `\n\nHot-reloaded: ${result.applied.join(", ")}`;
              }
              if (result.errors.length > 0) {
                reloadInfo += `\n\nReload warnings: ${result.errors.join("; ")}`;
              }
            }

            const what = params.key
              ? `"${params.key}" for plugin "${params.pluginId}"`
              : `all config for plugin "${params.pluginId}"`;
            return {
              content: [
                {
                  type: "text",
                  text: `Reset ${what} to defaults in ${configPath}\n\nDefault config:\n${JSON.stringify(updatedConfig, null, 2)}${reloadInfo}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
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
    return `## Configuration Manager
You can inspect and modify Marvis's configuration.
- Use \`get_config\` to see the current configuration
- Use \`get_config_value\` to read a specific setting by path (e.g., "llm.provider")
- Use \`set_config_value\` to change a setting (writes to config.toml and hot-reloads)
- Use \`list_config_plugins\` to see all plugins and their config schemas
- Use \`get_plugin_config\` to inspect a plugin's configuration and defaults
- Use \`set_plugin_config\` to update a plugin's configuration
- Use \`reset_plugin_config\` to restore a plugin's default settings
- Config changes are persisted to the TOML file and hot-reloaded immediately
- Manual edits to config.toml are also detected and applied automatically`;
  }
}
