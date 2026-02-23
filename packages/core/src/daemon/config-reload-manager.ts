import type { MarvisConfig } from "@marvis/config";
import type { PluginManager } from "../plugins/manager";
import type { MarvisAgent } from "../core/marvis";
import type { Logger } from "./logger";

export interface ConfigReloadResult {
  applied: string[];
  errors: string[];
}

/**
 * Orchestrates hot-reload of configuration changes.
 *
 * When the config file changes (detected by ConfigWatcher or triggered by
 * the ConfigPlugin after a write), this manager:
 * 1. Re-parses the config from disk
 * 2. Diffs old vs new config
 * 3. Applies core config changes (LLM, tools, logging)
 * 4. Notifies plugins whose config sections changed
 */
export class ConfigReloadManager {
  private loadConfigFn: () => MarvisConfig;
  private getCurrentConfig: () => MarvisConfig;
  private setCurrentConfig: (config: MarvisConfig) => void;
  private pluginManager: PluginManager;
  private marvisAgent: MarvisAgent;
  private logger: Logger;
  private isReloading = false;

  constructor(
    loadConfigFn: () => MarvisConfig,
    getCurrentConfig: () => MarvisConfig,
    setCurrentConfig: (config: MarvisConfig) => void,
    pluginManager: PluginManager,
    marvisAgent: MarvisAgent,
    logger: Logger,
  ) {
    this.loadConfigFn = loadConfigFn;
    this.getCurrentConfig = getCurrentConfig;
    this.setCurrentConfig = setCurrentConfig;
    this.pluginManager = pluginManager;
    this.marvisAgent = marvisAgent;
    this.logger = logger;
  }

  /**
   * Reload config from disk, diff against current, and apply changes.
   * Returns a summary of what was applied and any errors encountered.
   */
  async reload(): Promise<ConfigReloadResult> {
    // Prevent concurrent reloads
    if (this.isReloading) {
      return { applied: [], errors: ["Reload already in progress"] };
    }

    this.isReloading = true;
    const applied: string[] = [];
    const errors: string[] = [];

    try {
      // 1. Re-parse config from disk
      let newConfig: MarvisConfig;
      try {
        newConfig = this.loadConfigFn();
      } catch (err) {
        const msg = `Failed to parse config: ${err instanceof Error ? err.message : String(err)}`;
        this.logger.warn(msg);
        errors.push(msg);
        return { applied, errors };
      }

      const oldConfig = this.getCurrentConfig();

      // 2. Apply core config changes
      this.applyCoreChanges(oldConfig, newConfig, applied);

      // 3. Notify plugins whose config changed
      await this.notifyPlugins(oldConfig, newConfig, applied, errors);

      // 4. Update the stored config reference
      this.setCurrentConfig(newConfig);

      if (applied.length > 0) {
        this.logger.info(`Config reloaded: ${applied.join(", ")}`);
      } else {
        this.logger.debug("Config reloaded: no changes detected");
      }
    } finally {
      this.isReloading = false;
    }

    return { applied, errors };
  }

  private applyCoreChanges(
    oldConfig: MarvisConfig,
    newConfig: MarvisConfig,
    applied: string[],
  ): void {
    // LLM section
    if (
      oldConfig.llm.provider !== newConfig.llm.provider ||
      oldConfig.llm.model !== newConfig.llm.model
    ) {
      this.marvisAgent.updateConfig({
        provider: newConfig.llm.provider,
        model: newConfig.llm.model,
      });
      applied.push(`llm (${newConfig.llm.provider}/${newConfig.llm.model})`);
    }

    if (oldConfig.llm.apiKey !== newConfig.llm.apiKey) {
      this.marvisAgent.updateConfig({ apiKey: newConfig.llm.apiKey });
      applied.push("llm.apiKey");
    }

    // System prompt
    if (oldConfig.system.systemPrompt !== newConfig.system.systemPrompt) {
      this.marvisAgent.updateConfig({
        systemPrompt: newConfig.system.systemPrompt,
      });
      applied.push("system.systemPrompt");
    }

    // Tools section
    if (
      oldConfig.tools.confirmDangerous !== newConfig.tools.confirmDangerous ||
      oldConfig.tools.dangerThreshold !== newConfig.tools.dangerThreshold
    ) {
      this.marvisAgent.updateConfig({
        confirmDangerousTools: newConfig.tools.confirmDangerous,
        dangerThreshold: newConfig.tools.dangerThreshold,
      });
      applied.push("tools");
    }

    // Logging level
    if (oldConfig.logging.level !== newConfig.logging.level) {
      applied.push(`logging.level (${newConfig.logging.level})`);
    }

    if (oldConfig.logging.format !== newConfig.logging.format) {
      applied.push(`logging.format (${newConfig.logging.format})`);
    }
  }

  private async notifyPlugins(
    oldConfig: MarvisConfig,
    newConfig: MarvisConfig,
    applied: string[],
    errors: string[],
  ): Promise<void> {
    const oldPlugins = oldConfig.plugins;
    const newPlugins = newConfig.plugins;

    // Collect all plugin IDs that exist in either old or new config
    const allPluginIds = new Set([
      ...Object.keys(oldPlugins),
      ...Object.keys(newPlugins),
    ]);

    for (const pluginId of allPluginIds) {
      const oldPluginConfig = oldPlugins[pluginId] || {};
      const newPluginConfig = newPlugins[pluginId] || {};

      // Skip if config hasn't changed
      if (JSON.stringify(oldPluginConfig) === JSON.stringify(newPluginConfig)) {
        continue;
      }

      const plugin = this.pluginManager.getPlugin(pluginId);
      if (!plugin) {
        continue; // Plugin not loaded
      }

      try {
        if (plugin.onConfigChange) {
          await plugin.onConfigChange(newPluginConfig);
        }
        applied.push(`plugin.${pluginId}`);
      } catch (err) {
        const msg = `Failed to apply config for plugin "${pluginId}": ${
          err instanceof Error ? err.message : String(err)
        }`;
        this.logger.error(msg);
        errors.push(msg);
      }
    }
  }
}
