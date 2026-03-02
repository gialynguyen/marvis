# First-Class `load_on_startup` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `load_on_startup` a schema-validated, first-class field in plugin config by wrapping plugin schemas at the registry level, eliminating all ad-hoc stripping/force-setting logic.

**Architecture:** The `PluginConfigRegistry` wraps each plugin's schema with `loadOnStartup: Type.Optional(Type.Boolean())` on registration. `resolve()` returns a `ResolvedPluginConfig` that separates `loadOnStartup` from plugin-specific config. All downstream consumers (daemon, CLI, config tools) use this structured result.

**Tech Stack:** TypeBox (`@sinclair/typebox`), existing config system

---

## Task 1: Update `PluginConfigEntry` and `resolve()` Return Type

**Files:**
- Modify: `packages/config/src/plugin-registry.ts`

**Step 1: Add `ResolvedPluginConfig` type and update `PluginConfigEntry`**

Add the new interface and update the entry interface. Add `loadOnStartup` default to `PluginConfigEntry`:

```ts
// Add to PluginConfigEntry:
export interface PluginConfigEntry {
  pluginId: string;
  pluginName: string;
  schema: TObject;
  defaults: Record<string, unknown>;
  descriptions?: Record<string, string>;
  /** Default value for load_on_startup (default: false) */
  loadOnStartup?: boolean;
}

// New type for resolve() return:
export interface ResolvedPluginConfig {
  /** Whether the daemon should load this plugin at startup */
  loadOnStartup: boolean;
  /** Plugin-specific config, validated and merged with defaults */
  config: Record<string, unknown>;
}
```

**Step 2: Remove `DAEMON_LEVEL_KEYS` and `stripDaemonKeys`**

Delete the `DAEMON_LEVEL_KEYS` constant (line 47) and the `stripDaemonKeys` function (lines 52–59) entirely.

**Step 3: Add `Type` import and update `validate()` and `resolve()`**

Add `Type` import from `@sinclair/typebox`:

```ts
import { Type, type TObject, type TSchema } from "@sinclair/typebox";
```

Update `validate()` — instead of stripping daemon keys, separate `loadOnStartup`/`load_on_startup` from the plugin config and validate `loadOnStartup` as a boolean:

```ts
validate(pluginId: string, config: Record<string, unknown>): string[] {
  const entry = this.entries.get(pluginId);
  if (!entry) return [`Unknown plugin: ${pluginId}`];

  // Separate loadOnStartup from plugin-specific config
  const { loadOnStartup, config: pluginConfig } = this.separateLoadOnStartup(config);

  // Validate loadOnStartup type if present
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
```

Update `resolve()` to return `ResolvedPluginConfig`:

```ts
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
```

Add the private helper method:

```ts
/**
 * Separate load_on_startup / loadOnStartup from plugin-specific config keys.
 * Returns the extracted boolean (or undefined) and remaining config.
 */
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
```

**Step 4: Update `generateTomlSection()` to include `load_on_startup`**

```ts
generateTomlSection(pluginId: string): string {
  const entry = this.entries.get(pluginId);
  if (!entry) throw new Error(`Unknown plugin: ${pluginId}`);

  const lines: string[] = [];
  lines.push(`[plugins.${pluginId}]`);

  // load_on_startup — always include as the first field
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
```

**Step 5: Run typecheck to see what breaks**

Run:
```bash
cd /Users/gialynguyen/Dev/marvis && pnpm typecheck
```

Expected: Type errors in consumers that call `resolve()` and expect `Record<string, unknown>` — these will be fixed in subsequent tasks.

---

## Task 2: Update Plugin Registry Tests

**Files:**
- Modify: `packages/config/tests/plugin-registry.test.ts`

**Step 1: Update existing `resolve()` tests for new return shape**

The `resolve()` method now returns `ResolvedPluginConfig` instead of a flat `Record`. Update all tests that call `resolve()`:

For "should resolve config with defaults" (line ~108):
```ts
it("should resolve config with defaults", () => {
  registry.register({
    pluginId: "test",
    pluginName: "Test Plugin",
    schema: Type.Object({
      timeout: Type.Optional(Type.Number()),
      retries: Type.Optional(Type.Number()),
    }),
    defaults: { timeout: 5000, retries: 3 },
  });
  const resolved = registry.resolve("test", { timeout: 10000 });
  expect(resolved.config).toEqual({ timeout: 10000, retries: 3 });
  expect(resolved.loadOnStartup).toBe(false);
});
```

For "should resolve config with snake_case keys from TOML" (line ~193):
```ts
const resolved = registry.resolve("trading", {
  default_symbols: ["BTCUSDT", "ETHUSDT", "PAXGUSDT"],
  web_port: 8080,
});
expect(resolved.config).toEqual({
  defaultSymbols: ["BTCUSDT", "ETHUSDT", "PAXGUSDT"],
  webPort: 8080,
  exchange: "binance",
});
expect(resolved.loadOnStartup).toBe(false);
```

For "should still accept camelCase keys directly" (line ~215):
```ts
const resolved = registry.resolve("trading", {
  defaultSymbols: ["ETHUSDT"],
  webPort: 9999,
});
expect(resolved.config).toEqual({
  defaultSymbols: ["ETHUSDT"],
  webPort: 9999,
});
```

For "should leave unknown snake_case keys untouched" (line ~233):
```ts
const resolved = registry.resolve("test", {
  unknown_key: "value",
});
expect(resolved.config).toEqual({
  knownKey: "default",
  unknown_key: "value",
});
```

**Step 2: Replace "daemon-level key stripping" describe block with "load_on_startup validation"**

Replace the entire `describe("daemon-level key stripping", ...)` block (lines ~263–331) with:

```ts
describe("load_on_startup as first-class field", () => {
  it("should accept load_on_startup as boolean during validation", () => {
    registry.register({
      pluginId: "shell",
      pluginName: "Shell",
      schema: Type.Object({
        timeout: Type.Optional(Type.Number()),
      }),
      defaults: { timeout: 5000 },
    });
    const errors = registry.validate("shell", {
      timeout: 10000,
      load_on_startup: true,
    });
    expect(errors).toEqual([]);
  });

  it("should reject non-boolean load_on_startup during validation", () => {
    registry.register({
      pluginId: "shell",
      pluginName: "Shell",
      schema: Type.Object({
        timeout: Type.Optional(Type.Number()),
      }),
      defaults: { timeout: 5000 },
    });
    const errors = registry.validate("shell", {
      timeout: 10000,
      load_on_startup: "yes",
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("load_on_startup");
  });

  it("should separate load_on_startup from resolved plugin config", () => {
    registry.register({
      pluginId: "shell",
      pluginName: "Shell",
      schema: Type.Object({
        timeout: Type.Optional(Type.Number()),
      }),
      defaults: { timeout: 5000 },
    });
    const resolved = registry.resolve("shell", {
      timeout: 10000,
      load_on_startup: true,
    });
    expect(resolved.config).toEqual({ timeout: 10000 });
    expect(resolved.loadOnStartup).toBe(true);
  });

  it("should separate loadOnStartup (camelCase) from resolved config", () => {
    registry.register({
      pluginId: "test",
      pluginName: "Test",
      schema: Type.Object({
        foo: Type.Optional(Type.String()),
      }),
      defaults: { foo: "bar" },
    });
    const resolved = registry.resolve("test", {
      loadOnStartup: true,
    });
    expect(resolved.config).toEqual({ foo: "bar" });
    expect(resolved.loadOnStartup).toBe(true);
  });

  it("should default loadOnStartup to false when not specified", () => {
    registry.register({
      pluginId: "test",
      pluginName: "Test",
      schema: Type.Object({}),
      defaults: {},
    });
    const resolved = registry.resolve("test", {});
    expect(resolved.loadOnStartup).toBe(false);
  });

  it("should use entry-level loadOnStartup default", () => {
    registry.register({
      pluginId: "config",
      pluginName: "Config",
      schema: Type.Object({}),
      defaults: {},
      loadOnStartup: true,
    });
    const resolved = registry.resolve("config", {});
    expect(resolved.loadOnStartup).toBe(true);
  });

  it("should let user override entry-level loadOnStartup default", () => {
    registry.register({
      pluginId: "config",
      pluginName: "Config",
      schema: Type.Object({}),
      defaults: {},
      loadOnStartup: true,
    });
    const resolved = registry.resolve("config", { load_on_startup: false });
    expect(resolved.loadOnStartup).toBe(false);
  });

  it("should validate load_on_startup alongside other snake_case keys", () => {
    registry.register({
      pluginId: "trading",
      pluginName: "Trading",
      schema: Type.Object({
        defaultSymbols: Type.Optional(Type.Array(Type.String())),
        webPort: Type.Optional(Type.Number()),
      }),
      defaults: { defaultSymbols: ["BTCUSDT"], webPort: 3456 },
    });
    const errors = registry.validate("trading", {
      default_symbols: ["ETHUSDT"],
      web_port: 8080,
      load_on_startup: false,
    });
    expect(errors).toEqual([]);
  });
});
```

**Step 3: Update TOML generation tests**

Update "should generate TOML section for a plugin" test to expect `load_on_startup`:
```ts
it("should generate TOML section for a plugin", () => {
  registry.register({
    pluginId: "shell",
    pluginName: "Shell",
    schema: Type.Object({
      timeout: Type.Optional(Type.Number()),
    }),
    defaults: { timeout: 30000 },
    descriptions: { timeout: "Command timeout in ms" },
  });
  const toml = registry.generateTomlSection("shell");
  expect(toml).toContain("[plugins.shell]");
  expect(toml).toContain("# load_on_startup = false");
  expect(toml).toContain("# Command timeout in ms");
  expect(toml).toContain("# timeout = 30000");
});
```

Add test for TOML with `loadOnStartup: true` default:
```ts
it("should generate TOML section with loadOnStartup default true", () => {
  registry.register({
    pluginId: "config",
    pluginName: "Config",
    schema: Type.Object({}),
    defaults: {},
    loadOnStartup: true,
  });
  const toml = registry.generateTomlSection("config");
  expect(toml).toContain("# load_on_startup = true");
});
```

**Step 4: Run config package tests**

Run:
```bash
cd /Users/gialynguyen/Dev/marvis && pnpm --filter @marvis/config test -- --run
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/config/src/plugin-registry.ts packages/config/tests/plugin-registry.test.ts
git commit -m "feat(config): make load_on_startup a first-class validated field in plugin registry"
```

---

## Task 3: Update `loadConfig()` in Config Package

**Files:**
- Modify: `packages/config/src/config.ts`

**Step 1: Update the plugin resolution loop**

In `loadConfig()` (around line 370), the plugin resolution loop currently does:
```ts
config.plugins[pluginId] = registry.resolve(pluginId, userOverrides);
```

Update it to use the new `ResolvedPluginConfig` return type. Store `loadOnStartup` back in the plugin config for the daemon to read:

```ts
// Resolve plugin configs via registry (validate + merge defaults)
if (registry) {
  for (const pluginId of registry.listRegistered()) {
    const userOverrides = config.plugins[pluginId] || {};
    const errors = registry.validate(pluginId, userOverrides);
    if (errors.length > 0) {
      throw new ConfigError(
        `plugins.${pluginId}`,
        errors.join("; "),
        JSON.stringify(userOverrides),
        `TOML config (${configPath})`,
      );
    }
    const resolved = registry.resolve(pluginId, userOverrides);
    config.plugins[pluginId] = {
      ...resolved.config,
      loadOnStartup: resolved.loadOnStartup,
    };
  }
}
```

Note: `loadOnStartup` is stored as a camelCase key in the resolved config so the daemon can read it cleanly. This is a typed, validated boolean — no more `??` fallback.

**Step 2: Run config package tests**

Run:
```bash
cd /Users/gialynguyen/Dev/marvis && pnpm --filter @marvis/config test -- --run
```

Expected: All tests PASS

**Step 3: Commit**

```bash
git add packages/config/src/config.ts
git commit -m "feat(config): use ResolvedPluginConfig in loadConfig plugin resolution"
```

---

## Task 4: Update Daemon to Use Structured Config

**Files:**
- Modify: `packages/core/src/daemon/daemon.ts`

**Step 1: Update `loadBuiltinPlugins()` method**

Replace the current `loadBuiltinPlugins()` method (lines ~114–137) with:

```ts
private async loadBuiltinPlugins(): Promise<void> {
  for (const { plugin, config } of this.pendingPlugins) {
    const pluginId = plugin.manifest.id;
    const pluginConfig = {
      ...config,
      ...this.config.marvisConfig.plugins[pluginId],
    };

    // loadOnStartup is now a validated boolean set by the config system
    const { loadOnStartup, ...pluginInitConfig } = pluginConfig;

    if (loadOnStartup) {
      await this.pluginManager.loadPlugin(plugin, pluginInitConfig);
    } else {
      this.pluginManager.registerAvailable(plugin, pluginInitConfig);
    }
  }
  this.pendingPlugins = [];
}
```

Key changes:
- Uses `loadOnStartup` (camelCase) instead of `load_on_startup` (snake_case)
- No more `?? false` fallback — the registry guarantees a boolean
- Clean destructuring — no more inline comments about stripping

**Step 2: Run core package tests**

Run:
```bash
cd /Users/gialynguyen/Dev/marvis && pnpm --filter @marvis/core test -- --run
```

Expected: All tests PASS

**Step 3: Commit**

```bash
git add packages/core/src/daemon/daemon.ts
git commit -m "refactor(daemon): use validated loadOnStartup from config system"
```

---

## Task 5: Update CLI to Use Registry Defaults

**Files:**
- Modify: `apps/cli/src/cli/cli.ts`

**Step 1: Register essential plugins with `loadOnStartup: true`**

Currently `cli.ts` registers plugin config descriptors for plugins that have them (lines ~76–86), then force-sets `load_on_startup = true` for essential plugins (lines ~94–101).

Update the registration loop to also register `config` and `plugin-manager` plugins (they don't have `configDescriptor`, but they need `loadOnStartup: true`):

Replace lines ~76–101 (the registry registration + force-setting) with:

```ts
        // 3. Register plugin config descriptors into registry
        for (const plugin of [shellPlugin, tradingPlugin]) {
          if (plugin.configDescriptor) {
            registry.register({
              pluginId: plugin.manifest.id,
              pluginName: plugin.manifest.name,
              schema: plugin.configDescriptor.schema,
              defaults: plugin.configDescriptor.defaults,
              descriptions: plugin.configDescriptor.descriptions,
            });
          }
        }

        // Register essential plugins with loadOnStartup: true
        // These don't have configDescriptors but need to be in the registry
        // so loadOnStartup defaults are handled by the config system.
        registry.register({
          pluginId: "config",
          pluginName: "Configuration Manager",
          schema: Type.Object({}),
          defaults: {},
          loadOnStartup: true,
        });
        registry.register({
          pluginId: "plugin-manager",
          pluginName: "Plugin Manager",
          schema: Type.Object({}),
          defaults: {},
          loadOnStartup: true,
        });

        // 4. Load config with registry-aware validation + default resolution
        resetConfigCache();
        cachedConfig = loadConfig(undefined, registry);
        const config = cachedConfig;
```

Remove the entire "Set load_on_startup defaults for essential plugins" block (lines ~94–101 in the original):
```ts
        // DELETE THIS BLOCK:
        // Set load_on_startup defaults for essential plugins (if not set by user)
        // for (const essentialId of ["plugin-manager", "config"]) {
        //   ...
        // }
```

**Step 2: Add `Type` import**

Add to the imports at the top of `cli.ts`:
```ts
import { Type } from "@sinclair/typebox";
```

**Step 3: Run typecheck**

Run:
```bash
cd /Users/gialynguyen/Dev/marvis && pnpm typecheck
```

Expected: No errors

**Step 4: Commit**

```bash
git add apps/cli/src/cli/cli.ts
git commit -m "refactor(cli): use registry loadOnStartup defaults for essential plugins"
```

---

## Task 6: Update Plugin Config Tools

**Files:**
- Modify: `packages/plugin-config/src/tools.ts`
- Modify: `packages/plugin-config/tests/tools.test.ts`

**Step 1: Update `setPluginConfig` to use new `resolve()` return shape**

In `setPluginConfig()` (around line 216), the return calls `registry.resolve()`:
```ts
return {
  updatedConfig: registry.resolve(pluginId, pluginsObj[pluginId]),
  configPath,
};
```

Update to:
```ts
const resolved = registry.resolve(pluginId, pluginsObj[pluginId]);
return {
  updatedConfig: resolved.config,
  configPath,
};
```

**Step 2: Update `resetPluginConfig` return**

In `resetPluginConfig()`, the return value uses `entry.defaults` directly, which is unchanged. No modification needed here.

**Step 3: Update `getPluginConfig` — the `currentConfig` field**

In `getPluginConfig()` (around line 144), it returns `config.plugins[pluginId]` as the current config. After our changes, `config.plugins[pluginId]` now includes `loadOnStartup`. We should strip it from the current config display to only show plugin-specific fields:

```ts
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
```

**Step 4: Run plugin-config tests**

Run:
```bash
cd /Users/gialynguyen/Dev/marvis && pnpm --filter @marvis/plugin-config test -- --run
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/plugin-config/src/tools.ts packages/plugin-config/tests/tools.test.ts
git commit -m "refactor(plugin-config): update tools for ResolvedPluginConfig return shape"
```

---

## Task 7: Full Verification

**Step 1: Run all tests**

Run:
```bash
cd /Users/gialynguyen/Dev/marvis && pnpm test -- --run
```

Expected: All tests PASS

**Step 2: Run typecheck**

Run:
```bash
cd /Users/gialynguyen/Dev/marvis && pnpm typecheck
```

Expected: No errors

**Step 3: Run build**

Run:
```bash
cd /Users/gialynguyen/Dev/marvis && pnpm build
```

Expected: Build succeeds

**Step 4: Run lint**

Run:
```bash
cd /Users/gialynguyen/Dev/marvis && pnpm lint
```

Expected: No errors

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Update `PluginConfigEntry`, remove stripping, add `ResolvedPluginConfig` | `plugin-registry.ts` |
| 2 | Update registry tests for new behavior | `plugin-registry.test.ts` |
| 3 | Update `loadConfig()` plugin resolution | `config.ts` |
| 4 | Update daemon `loadBuiltinPlugins()` | `daemon.ts` |
| 5 | Move essential plugin defaults to registry | `cli.ts` |
| 6 | Update plugin-config tools for new `resolve()` shape | `tools.ts`, `tools.test.ts` |
| 7 | Full verification (tests, typecheck, build, lint) | — |

**Total: 7 tasks**
