import type { TObject, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export interface PluginConfigEntry {
  pluginId: string;
  pluginName: string;
  schema: TObject;
  defaults: Record<string, unknown>;
  descriptions?: Record<string, string>;
  /** Default value for load_on_startup (default: false) */
  loadOnStartup?: boolean;
}

export interface ResolvedPluginConfig {
  /** Whether the daemon should load this plugin at startup */
  loadOnStartup: boolean;
  /** Plugin-specific config, validated and merged with defaults */
  config: Record<string, unknown>;
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

  private separateLoadOnStartup(config: Record<string, unknown>): {
    loadOnStartup: boolean | undefined;
    config: Record<string, unknown>;
  } {
    const rest: Record<string, unknown> = {};
    let loadOnStartup: boolean | undefined;

    for (const [key, value] of Object.entries(config)) {
      if (key === "load_on_startup" || key === "loadOnStartup") {
        loadOnStartup = value as boolean | undefined;
      } else {
        rest[key] = value;
      }
    }

    return { loadOnStartup, config: rest };
  }

  /** Validate a plugin's config against its schema. Returns errors or empty array. */
  validate(pluginId: string, config: Record<string, unknown>): string[] {
    const entry = this.entries.get(pluginId);
    if (!entry) return [`Unknown plugin: ${pluginId}`];

    const { loadOnStartup, config: pluginConfig } = this.separateLoadOnStartup(config);

    if (loadOnStartup !== undefined && typeof loadOnStartup !== "boolean") {
      return [`load_on_startup: Expected boolean, received ${typeof loadOnStartup}`];
    }

    const schemaKeys = new Set(Object.keys(entry.defaults));
    const normalized = normalizeKeys(pluginConfig, schemaKeys);
    const merged = { ...entry.defaults, ...normalized };
    if (Value.Check(entry.schema, merged)) return [];

    return [...Value.Errors(entry.schema, merged)].map(
      (e) => `${e.path}: ${e.message}`,
    );
  }

  /** Get the resolved (defaults + overrides merged) config for a plugin */
  resolve(pluginId: string, overrides: Record<string, unknown> = {}): ResolvedPluginConfig {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new Error(`Unknown plugin: ${pluginId}`);

    const { loadOnStartup, config: pluginConfig } = this.separateLoadOnStartup(overrides);
    const schemaKeys = new Set(Object.keys(entry.defaults));
    const normalized = normalizeKeys(pluginConfig, schemaKeys);

    return {
      loadOnStartup: loadOnStartup ?? entry.loadOnStartup ?? false,
      config: { ...entry.defaults, ...normalized },
    };
  }

  /** Generate TOML snippet for a specific plugin (for config file generation) */
  generateTomlSection(pluginId: string): string {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new Error(`Unknown plugin: ${pluginId}`);

    const lines: string[] = [];
    lines.push(`[plugins.${pluginId}]`);

    const losDefault = entry.loadOnStartup ?? false;
    lines.push("# Whether to load this plugin automatically at daemon startup");
    lines.push(`# load_on_startup = ${losDefault}`);

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

  /**
   * Build the unified config schema for the entire system.
   *
   * Returns a JSON-serializable object containing:
   * - `core`: the core MarvisConfigSchema as standard JSON Schema
   * - `plugins`: a map of plugin ID → { schema, defaults, descriptions }
   *
   * TypeBox schemas are JSON Schema–compatible by design; this method strips
   * internal TypeBox symbols (Kind, Hint) so the result is safely serializable.
   */
  getFullSchema(coreSchema: TObject): ConfigSchemaInfo {
    const plugins: Record<string, PluginSchemaInfo> = {};

    for (const entry of this.entries.values()) {
      plugins[entry.pluginId] = {
        pluginName: entry.pluginName,
        schema: stripTypeBoxSymbols(entry.schema),
        defaults: entry.defaults,
        descriptions: entry.descriptions ?? {},
        loadOnStartup: entry.loadOnStartup ?? false,
      };
    }

    return {
      core: stripTypeBoxSymbols(coreSchema),
      plugins,
    };
  }
}

// ============= Schema Info Types =============

export interface PluginSchemaInfo {
  pluginName: string;
  schema: Record<string, unknown>;
  defaults: Record<string, unknown>;
  descriptions: Record<string, string>;
  /** Default value for load_on_startup */
  loadOnStartup: boolean;
}

export interface ConfigSchemaInfo {
  core: Record<string, unknown>;
  plugins: Record<string, PluginSchemaInfo>;
}

// ============= Helpers =============

/**
 * Recursively strip TypeBox internal symbols (Symbol-keyed properties like
 * `[Kind]` and `[Hint]`) from a schema object so it becomes a plain
 * JSON-serializable JSON Schema.
 */
function stripTypeBoxSymbols(schema: TSchema): Record<string, unknown> {
  if (schema === null || typeof schema !== "object") {
    return schema as unknown as Record<string, unknown>;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) =>
      typeof item === "object" && item !== null
        ? stripTypeBoxSymbols(item)
        : item,
    ) as unknown as Record<string, unknown>;
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(schema)) {
    const value = (schema as Record<string, unknown>)[key];
    if (typeof value === "object" && value !== null) {
      result[key] = stripTypeBoxSymbols(value as TSchema);
    } else {
      result[key] = value;
    }
  }
  return result;
}
