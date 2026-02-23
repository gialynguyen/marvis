import type { TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export interface PluginConfigEntry {
  pluginId: string;
  pluginName: string;
  schema: TObject;
  defaults: Record<string, unknown>;
  descriptions?: Record<string, string>;
}

/** Convert a snake_case key to camelCase (e.g. "default_symbols" → "defaultSymbols") */
function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** Convert a camelCase key to snake_case (e.g. "defaultSymbols" → "default_symbols") */
function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Normalize config keys from TOML snake_case to camelCase.
 * Only converts keys that have a matching camelCase counterpart in the
 * known schema keys; unknown keys are left as-is.
 */
function normalizeKeys(
  config: Record<string, unknown>,
  schemaKeys: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const camel = snakeToCamel(key);
    if (camel !== key && schemaKeys.has(camel)) {
      result[camel] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class PluginConfigRegistry {
  private entries = new Map<string, PluginConfigEntry>();

  /** Register a plugin's config schema + defaults */
  register(entry: PluginConfigEntry): void {
    if (this.entries.has(entry.pluginId)) {
      throw new Error(`Plugin config already registered: ${entry.pluginId}`);
    }
    this.entries.set(entry.pluginId, entry);
  }

  /** Unregister a plugin */
  unregister(pluginId: string): void {
    this.entries.delete(pluginId);
  }

  /** Get a registered plugin's config entry */
  get(pluginId: string): PluginConfigEntry | undefined {
    return this.entries.get(pluginId);
  }

  /** List all registered plugin IDs */
  listRegistered(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Get all entries */
  getAll(): PluginConfigEntry[] {
    return Array.from(this.entries.values());
  }

  /** Validate a plugin's config against its schema. Returns errors or empty array. */
  validate(pluginId: string, config: Record<string, unknown>): string[] {
    const entry = this.entries.get(pluginId);
    if (!entry) return [`Unknown plugin: ${pluginId}`];

    const schemaKeys = new Set(Object.keys(entry.defaults));
    const normalized = normalizeKeys(config, schemaKeys);
    const merged = { ...entry.defaults, ...normalized };
    if (Value.Check(entry.schema, merged)) return [];

    return [...Value.Errors(entry.schema, merged)].map(
      (e) => `${e.path}: ${e.message}`,
    );
  }

  /** Get the resolved (defaults + overrides merged) config for a plugin */
  resolve(pluginId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new Error(`Unknown plugin: ${pluginId}`);
    const schemaKeys = new Set(Object.keys(entry.defaults));
    const normalized = normalizeKeys(overrides, schemaKeys);
    return { ...entry.defaults, ...normalized };
  }

  /** Generate TOML snippet for a specific plugin (for config file generation) */
  generateTomlSection(pluginId: string): string {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new Error(`Unknown plugin: ${pluginId}`);

    const lines: string[] = [];
    lines.push(`[plugins.${pluginId}]`);

    for (const [key, value] of Object.entries(entry.defaults)) {
      const tomlKey = camelToSnake(key);
      const desc = entry.descriptions?.[key];
      if (desc) lines.push(`# ${desc}`);
      lines.push(`# ${tomlKey} = ${JSON.stringify(value)}`);
    }

    return lines.join("\n");
  }

  /** Generate complete plugin TOML sections for all registered plugins */
  generateAllPluginToml(): string {
    return this.listRegistered()
      .map((id) => this.generateTomlSection(id))
      .join("\n\n");
  }
}
