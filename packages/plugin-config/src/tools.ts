import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  type MarvisConfig,
  type PluginConfigRegistry,
  type ConfigSchemaInfo,
  MarvisConfigSchema,
  getConfigPath,
  loadConfig,
} from "@marvis/config";

/**
 * Read the current in-memory config, optionally filtered by section.
 * Redacts sensitive fields like apiKey.
 */
export function getConfig(
  config: MarvisConfig,
  section?: string,
): Record<string, unknown> {
  const redacted = structuredClone(config) as Record<string, unknown>;

  // Redact sensitive fields
  const llm = redacted.llm as Record<string, unknown> | undefined;
  if (llm?.apiKey) {
    llm.apiKey = "***REDACTED***";
  }

  if (section) {
    if (!(section in redacted)) {
      throw new Error(
        `Unknown config section: "${section}". Valid sections: ${Object.keys(redacted).join(", ")}`,
      );
    }
    return { [section]: redacted[section] };
  }

  return redacted;
}

/**
 * Get a specific config value by dot-path.
 */
export function getConfigValue(
  config: MarvisConfig,
  path: string,
): unknown {
  const parts = path.split(".");
  let current: unknown = config;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      throw new Error(`Config path "${path}" not found: "${part}" is not an object`);
    }
    const obj = current as Record<string, unknown>;
    if (!(part in obj)) {
      throw new Error(`Config path "${path}" not found: key "${part}" does not exist`);
    }
    current = obj[part];
  }

  // Redact sensitive fields
  if (path === "llm.apiKey" && current) {
    return "***REDACTED***";
  }

  return current;
}

/**
 * Set a config value by dot-path and persist to TOML file.
 * Returns the updated section.
 */
export function setConfigValue(
  path: string,
  value: unknown,
): { updatedSection: Record<string, unknown>; configPath: string } {
  const configPath = getConfigPath();

  // Read current TOML
  let tomlObj: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, "utf-8");
    tomlObj = parseToml(content) as Record<string, unknown>;
  }

  // Convert camelCase path to snake_case for TOML keys
  const tomlPath = path.split(".").map(camelToSnake);

  // Coerce string values that look like JSON arrays/objects
  const coercedValue = coerceJsonString(value);

  // Set the value in the TOML object
  setNestedValue(tomlObj, tomlPath, coercedValue);

  // Write back
  writeFileSync(configPath, stringifyToml(tomlObj), "utf-8");

  // Return the updated top-level section
  const sectionKey = tomlPath[0];
  return {
    updatedSection: { [sectionKey]: tomlObj[sectionKey] },
    configPath,
  };
}

/**
 * List all registered plugins with their config information.
 */
export function listPlugins(
  registry: PluginConfigRegistry,
): Array<{
  id: string;
  name: string;
  hasConfig: boolean;
  configFields: string[];
}> {
  return registry.getAll().map((entry) => ({
    id: entry.pluginId,
    name: entry.pluginName,
    hasConfig: true,
    configFields: Object.keys(entry.defaults),
  }));
}

/**
 * Get a specific plugin's config details.
 */
export function getPluginConfig(
  registry: PluginConfigRegistry,
  config: MarvisConfig,
  pluginId: string,
): {
  currentConfig: Record<string, unknown>;
  defaults: Record<string, unknown>;
  descriptions: Record<string, string>;
} {
  const entry = registry.get(pluginId);
  if (!entry) {
    throw new Error(
      `Plugin "${pluginId}" not found in registry. Registered plugins: ${registry.listRegistered().join(", ") || "(none)"}`,
    );
  }

  // Strip loadOnStartup from current config — it's a daemon-level concern
  const rawConfig = (config.plugins[pluginId] as Record<string, unknown>) || {};
  const { loadOnStartup: _, ...currentConfig } = rawConfig;

  return {
    currentConfig: Object.keys(currentConfig).length > 0 ? currentConfig : entry.defaults,
    defaults: entry.defaults,
    descriptions: entry.descriptions || {},
  };
}

/**
 * Set a plugin config value and persist to TOML file.
 */
export function setPluginConfig(
  registry: PluginConfigRegistry,
  pluginId: string,
  key: string,
  value: unknown,
): { updatedConfig: Record<string, unknown>; configPath: string } {
  const entry = registry.get(pluginId);
  if (!entry) {
    throw new Error(
      `Plugin "${pluginId}" not found in registry. Registered plugins: ${registry.listRegistered().join(", ") || "(none)"}`,
    );
  }

  // Normalize the key: accept both camelCase and snake_case from the caller.
  // We store in TOML using snake_case (TOML convention), but validate/resolve
  // using camelCase (TypeScript convention).
  const tomlKey = camelToSnake(key);
  const camelKey = snakeToCamel(key);

  // Coerce string values that look like JSON arrays/objects into their actual
  // types.  LLMs frequently serialize structured values as JSON strings
  // (e.g. "[\"BTCUSDT\"]" instead of a real array), which would otherwise be
  // written as a TOML string and fail schema validation on reload.
  const coercedValue = coerceJsonString(value);

  // Build the proposed config
  const configPath = getConfigPath();
  let tomlObj: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, "utf-8");
    tomlObj = parseToml(content) as Record<string, unknown>;
  }

  // Ensure plugins section exists
  if (!tomlObj.plugins || typeof tomlObj.plugins !== "object") {
    tomlObj.plugins = {};
  }
  const pluginsObj = tomlObj.plugins as Record<string, Record<string, unknown>>;
  if (!pluginsObj[pluginId] || typeof pluginsObj[pluginId] !== "object") {
    pluginsObj[pluginId] = {};
  }

  // Remove any existing key under the alternative casing to avoid duplicates.
  // e.g. if "defaultSymbols" existed and we're now writing "default_symbols".
  if (tomlKey !== camelKey) {
    delete pluginsObj[pluginId][camelKey];
  }

  // Set the key using snake_case for TOML
  pluginsObj[pluginId][tomlKey] = coercedValue;

  // Validate against schema (registry.validate normalizes snake→camel internally)
  const errors = registry.validate(pluginId, pluginsObj[pluginId]);
  if (errors.length > 0) {
    throw new Error(`Invalid config for plugin "${pluginId}": ${errors.join("; ")}`);
  }

  // Write back
  writeFileSync(configPath, stringifyToml(tomlObj), "utf-8");

  const resolved = registry.resolve(pluginId, pluginsObj[pluginId]);
  return {
    updatedConfig: resolved.config,
    configPath,
  };
}

/**
 * Reset a plugin's config back to defaults.
 */
export function resetPluginConfig(
  registry: PluginConfigRegistry,
  pluginId: string,
  key?: string,
): { updatedConfig: Record<string, unknown>; configPath: string } {
  const entry = registry.get(pluginId);
  if (!entry) {
    throw new Error(
      `Plugin "${pluginId}" not found in registry. Registered plugins: ${registry.listRegistered().join(", ") || "(none)"}`,
    );
  }

  const configPath = getConfigPath();
  let tomlObj: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, "utf-8");
    tomlObj = parseToml(content) as Record<string, unknown>;
  }

  // Ensure plugins section exists
  if (!tomlObj.plugins || typeof tomlObj.plugins !== "object") {
    tomlObj.plugins = {};
  }
  const pluginsObj = tomlObj.plugins as Record<string, Record<string, unknown>>;

  if (key) {
    // Reset only a specific key — normalize to handle both camelCase and snake_case input
    const camelKey = snakeToCamel(key);
    const tomlKey = camelToSnake(key);

    if (!pluginsObj[pluginId]) {
      pluginsObj[pluginId] = {};
    }

    // Remove both possible casings to avoid duplicates
    delete pluginsObj[pluginId][camelKey];
    delete pluginsObj[pluginId][tomlKey];

    // Write the default back using snake_case for TOML
    if (camelKey in entry.defaults) {
      pluginsObj[pluginId][tomlKey] = entry.defaults[camelKey];
    }
  } else {
    // Reset the entire plugin config section (remove overrides)
    delete pluginsObj[pluginId];
  }

  // Write back
  writeFileSync(configPath, stringifyToml(tomlObj), "utf-8");

  return {
    updatedConfig: entry.defaults,
    configPath,
  };
}

/**
 * Get the unified config schema for the entire system.
 * Returns the core MarvisConfigSchema + all registered plugin schemas
 * as standard JSON Schema objects.
 */
export function getConfigSchema(
  registry: PluginConfigRegistry,
): ConfigSchemaInfo {
  return registry.getFullSchema(MarvisConfigSchema);
}

// ============= Helpers =============

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * If `value` is a string that looks like a JSON array or object, parse it
 * into the actual structure.  LLMs frequently stringify structured values
 * (e.g. sending `"[\"BTCUSDT\"]"` instead of `["BTCUSDT"]`), which would
 * otherwise be persisted as a TOML string and fail schema validation.
 *
 * Only arrays and objects are coerced – plain scalars (numbers, booleans,
 * strings that don't look like JSON) are returned as-is.
 */
function coerceJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Not valid JSON – return as plain string
    }
  }
  return value;
}

function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}
