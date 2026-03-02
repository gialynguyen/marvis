import type { PluginManager, PluginInfo } from "@marvis/core";

/**
 * List all plugins (both loaded and available).
 */
export function listAllPlugins(manager: PluginManager): PluginInfo[] {
  return manager.getAllPlugins();
}

/**
 * List only currently loaded plugins.
 */
export function listLoadedPlugins(manager: PluginManager): PluginInfo[] {
  return manager.getLoadedPlugins();
}

/**
 * Get detailed info about a specific plugin.
 * Looks in both loaded and available plugins.
 */
export function getPluginInfo(
  manager: PluginManager,
  pluginId: string,
): {
  info: PluginInfo;
  healthCheck?: { healthy: boolean; message?: string };
} {
  // Check loaded plugins first
  const loaded = manager.getLoadedPlugins().find((p) => p.id === pluginId);
  if (loaded) {
    return { info: loaded };
  }

  // Check available plugins
  const available = manager.getAvailablePlugins().find((p) => p.id === pluginId);
  if (available) {
    return { info: available };
  }

  throw new Error(
    `Plugin "${pluginId}" not found. Available plugins: ${manager
      .getAllPlugins()
      .map((p) => p.id)
      .join(", ") || "(none)"}`,
  );
}

/**
 * Load an available (registered but not loaded) plugin.
 */
export async function loadPlugin(
  manager: PluginManager,
  pluginId: string,
): Promise<PluginInfo> {
  if (manager.isLoaded(pluginId)) {
    throw new Error(`Plugin "${pluginId}" is already loaded`);
  }
  if (!manager.isAvailable(pluginId)) {
    throw new Error(
      `Plugin "${pluginId}" is not available. Available plugins: ${manager
        .getAvailablePlugins()
        .map((p) => p.id)
        .join(", ") || "(none)"}`,
    );
  }

  await manager.loadRegisteredPlugin(pluginId);

  const info = manager.getLoadedPlugins().find((p) => p.id === pluginId);
  if (!info) {
    throw new Error(`Plugin "${pluginId}" loaded but not found in loaded list`);
  }
  return info;
}

/**
 * Unload a currently loaded plugin and move it back to available state.
 */
export async function unloadPlugin(
  manager: PluginManager,
  pluginId: string,
  protectedPlugins: string[] = [],
): Promise<void> {
  if (protectedPlugins.includes(pluginId)) {
    throw new Error(
      `Cannot unload "${pluginId}": it is a protected plugin required for system operation`,
    );
  }
  if (!manager.isLoaded(pluginId)) {
    throw new Error(
      `Plugin "${pluginId}" is not loaded. Loaded plugins: ${manager
        .getLoadedPlugins()
        .map((p) => p.id)
        .join(", ") || "(none)"}`,
    );
  }

  await manager.unloadToAvailable(pluginId);
}

/**
 * Reload a plugin: unload it and then load it again.
 */
export async function reloadPlugin(
  manager: PluginManager,
  pluginId: string,
  protectedPlugins: string[] = [],
): Promise<PluginInfo> {
  if (protectedPlugins.includes(pluginId)) {
    throw new Error(
      `Cannot reload "${pluginId}": it is a protected plugin required for system operation`,
    );
  }
  if (!manager.isLoaded(pluginId)) {
    throw new Error(
      `Plugin "${pluginId}" is not loaded. Cannot reload an unloaded plugin.`,
    );
  }

  await manager.unloadToAvailable(pluginId);
  await manager.loadRegisteredPlugin(pluginId);

  const info = manager.getLoadedPlugins().find((p) => p.id === pluginId);
  if (!info) {
    throw new Error(`Plugin "${pluginId}" reloaded but not found in loaded list`);
  }
  return info;
}

/**
 * Run health check on a loaded plugin.
 */
export async function getPluginHealth(
  manager: PluginManager,
  pluginId: string,
): Promise<{ pluginId: string; healthy: boolean; message?: string }> {
  const plugin = manager.getPlugin(pluginId);
  if (!plugin) {
    throw new Error(
      `Plugin "${pluginId}" is not loaded. Can only health-check loaded plugins.`,
    );
  }

  const result = await plugin.healthCheck();
  return {
    pluginId,
    healthy: result.healthy,
    message: result.message,
  };
}
