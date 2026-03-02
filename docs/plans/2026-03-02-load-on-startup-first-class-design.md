# First-Class `load_on_startup` in Plugin Config

**Date:** 2026-03-02
**Status:** Approved

## Problem

`load_on_startup` is a daemon-level config key that controls whether a plugin is loaded immediately at startup or kept in "available" (lazy) state. Currently it has no schema, no validation, and is handled by three ad-hoc mechanisms:

1. **`DAEMON_LEVEL_KEYS` stripping** in `plugin-registry.ts` — silently removes it before validation so it doesn't fail against plugin schemas that don't declare it.
2. **Manual destructuring** in `daemon.ts` — `const { load_on_startup: _, ...pluginInitConfig } = pluginConfig` before passing config to plugins.
3. **Force-setting defaults** in `cli.ts` — hardcodes `load_on_startup = true` for essential plugins (`plugin-manager`, `config`) if the user didn't set it.

### Consequences

- **No type checking**: `load_on_startup = "yes"` (string) silently works because the daemon uses `??` which treats any truthy value as true.
- **Not in generated TOML**: `generateTomlSection()` only outputs plugin-declared fields, so users have to know about `load_on_startup` from documentation.
- **Scattered defaults**: The default (`false`) lives in `daemon.ts`, overrides for essential plugins live in `cli.ts`. No single source of truth.
- **Fragile stripping**: Adding another daemon-level key requires remembering to update the `DAEMON_LEVEL_KEYS` set.

## Solution

Make `load_on_startup` a first-class, schema-validated field by having the `PluginConfigRegistry` automatically wrap each plugin's schema with it.

### Design

**Registry wraps plugin schemas on registration:**

When `register()` is called, the registry creates a wrapped schema that includes `loadOnStartup: Type.Optional(Type.Boolean())` alongside the plugin's own fields. The plugin's original schema and the wrapped schema are both stored.

**`resolve()` returns structured output:**

Instead of returning a flat `Record<string, unknown>`, `resolve()` separates daemon-level and plugin-level config:

```ts
interface ResolvedPluginConfig {
  /** Whether the daemon should load this plugin at startup (default: false) */
  loadOnStartup: boolean;
  /** Plugin-specific config, validated against the plugin's own schema */
  config: Record<string, unknown>;
}
```

**`validate()` validates `load_on_startup` as a boolean:**

Instead of stripping it, the wrapped schema validates it. If a user writes `load_on_startup = "yes"`, they get a clear validation error.

**`generateTomlSection()` includes `load_on_startup`:**

Generated TOML sections include `# load_on_startup = false` (or `true` for essential plugins) with a descriptive comment.

**`PluginConfigEntry` gains a `loadOnStartup` default:**

```ts
interface PluginConfigEntry {
  pluginId: string;
  pluginName: string;
  schema: TObject;           // plugin's own schema (unchanged)
  defaults: Record<string, unknown>;  // plugin's own defaults (unchanged)
  descriptions?: Record<string, string>;
  loadOnStartup?: boolean;   // NEW: default for load_on_startup (default: false)
}
```

Essential plugins (`config`, `plugin-manager`) register with `loadOnStartup: true`.

**Remove ad-hoc mechanisms:**

- Remove `DAEMON_LEVEL_KEYS` set and `stripDaemonKeys()` function from `plugin-registry.ts`.
- Remove manual destructuring in `daemon.ts` — use `resolved.loadOnStartup` and `resolved.config`.
- Remove force-setting in `cli.ts` — defaults come from registry entries.

### Changes by File

| File | Change |
|------|--------|
| `packages/config/src/plugin-registry.ts` | Add `loadOnStartup` to `PluginConfigEntry`. Wrap schemas. Update `validate()`, `resolve()` to return `ResolvedPluginConfig`. Update `generateTomlSection()`. Remove `DAEMON_LEVEL_KEYS`/`stripDaemonKeys`. |
| `packages/config/tests/plugin-registry.test.ts` | Update tests: stripping tests become validation tests, resolve tests check new return shape. |
| `packages/core/src/daemon/daemon.ts` | `loadBuiltinPlugins()` uses `registry.resolve()` result instead of raw property access. |
| `apps/cli/src/cli/cli.ts` | Remove force-setting of `load_on_startup` for essential plugins. Pass `loadOnStartup: true` when registering `config` and `plugin-manager` plugin entries. |
| `packages/config/src/config.ts` | `loadConfig()` plugin resolution uses new `resolve()` return shape — store only `config` portion in `config.plugins[id]`. |
| `packages/plugin-config/src/plugin.ts` | No changes (doesn't declare `configDescriptor`). |
| `packages/plugin-config/src/tools.ts` | Minor: `setPluginConfig` / `resetPluginConfig` may need adjustment for the new `resolve()` shape. |
| `packages/core/src/plugins/plugin.ts` | No changes. Plugins still declare only their own fields. |
| `packages/plugin-shell/src/index.ts` | No changes. |
| `packages/plugin-trading/src/plugin.ts` | No changes. |

### What Stays the Same

- Plugin authors still declare only their own config fields in `configDescriptor`. They never see `load_on_startup`.
- TOML config file format stays the same: `load_on_startup` lives under `[plugins.<id>]`.
- Snake↔camel normalization still applies (`load_on_startup` in TOML ↔ `loadOnStartup` in TypeScript).

### Example

TOML:
```toml
[plugins.trading]
load_on_startup = true
exchange = "binance"
web_port = 3456
```

Registry resolves to:
```ts
{
  loadOnStartup: true,
  config: { exchange: "binance", webPort: 3456, defaultSymbols: ["BTCUSDT", ...] }
}
```

Daemon reads `resolved.loadOnStartup` → loads immediately. Passes `resolved.config` to `plugin.initialize()`.
