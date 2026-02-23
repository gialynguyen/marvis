# Config System Implementation Plan

> **⚠️ Post-Migration Note (2026-02-27):** This document was written before the monorepo migration.
> The project has been restructured from a flat `src/` layout into a pnpm monorepo with:
> - `packages/core/` (@marvis/core) — Core logic, daemon, memory, plugin system, types
> - `packages/plugin-shell/` (@marvis/plugin-shell) — Shell command plugin
> - `apps/cli/` (@marvis/cli) — CLI interface
>
> All file paths, import paths, and build commands in this document have been updated to reflect the new structure.
> Build: `pnpm build` (Turborepo) | Test: `pnpm test` | Lint: `pnpm lint` (Biome.js)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace environment-variable-only config with TOML-based config system at `~/.marvis/config.toml` with full precedence chain (CLI > Env > TOML > Defaults).

**Architecture:** Single unified `loadConfig()` function that merges defaults → TOML file → env vars → CLI args, validates with TypeBox, and returns typed `MarvisConfig`. Auto-creates config file on first run.

**Tech Stack:** smol-toml (TOML parser), @sinclair/typebox (validation, already in project)

---

## Task 1: Add smol-toml Dependency

**Files:**
- Modify: `package.json` (root)

**Step 1: Install smol-toml**

Run:
```bash
pnpm install smol-toml
```

**Step 2: Verify installation**

Run:
```bash
pnpm list smol-toml
```

Expected: `smol-toml@1.x.x`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add smol-toml dependency for TOML config parsing"
```

---

## Task 2: Expand MarvisConfig Type

**Files:**
- Modify: `packages/core/src/types/index.ts:96-121`
- Test: `packages/core/tests/core/config.test.ts`

**Step 1: Write failing test for new config sections**

Add to `packages/core/tests/core/config.test.ts`:

```typescript
it("should have paths section in default config", () => {
  const config = loadConfig();
  expect(config.paths).toBeDefined();
  expect(config.paths.dataDir).toContain(".marvis");
});

it("should have logging section in default config", () => {
  const config = loadConfig();
  expect(config.logging).toBeDefined();
  expect(config.logging.level).toBe("info");
});

it("should have empty plugins and aliases by default", () => {
  const config = loadConfig();
  expect(config.plugins).toEqual({});
  expect(config.aliases).toEqual({});
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: FAIL - `config.paths` is undefined

**Step 3: Update MarvisConfig interface**

Modify `packages/core/src/types/index.ts`, replace the existing `MarvisConfig` interface (lines 98-112):

```typescript
export interface MarvisConfig {
  llm: {
    provider: "openai" | "anthropic" | "google";
    model: string;
    fallbackProvider?: "openai" | "anthropic" | "google";
    fallbackModel?: string;
  };
  tools: {
    confirmDangerous: boolean;
    dangerThreshold: "moderate" | "dangerous";
  };
  system: {
    systemPrompt: string;
  };
  paths: {
    dataDir: string;
    logDir: string;
    socketPath: string;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    format: "text" | "json";
    file?: string;
  };
  plugins: Record<string, Record<string, unknown>>;
  aliases: Record<string, string>;
}
```

**Step 4: Update DEFAULT_CONFIG in config.ts**

Modify `packages/core/src/core/config.ts`, update `DEFAULT_CONFIG`:

```typescript
import { homedir } from "os";
import { join } from "path";
import { type MarvisConfig } from "../types/index.js";

const MARVIS_HOME = join(homedir(), ".marvis");

export const DEFAULT_CONFIG: MarvisConfig = {
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-0",
  },
  tools: {
    confirmDangerous: true,
    dangerThreshold: "dangerous",
  },
  system: {
    systemPrompt: `You are Marvis, a helpful personal AI assistant running on the user's local machine.

You have access to tools that let you interact with the system. Use them when appropriate to help the user.

Be concise but thorough. When executing commands or making changes, explain what you're doing.`,
  },
  paths: {
    dataDir: join(MARVIS_HOME, "data"),
    logDir: join(MARVIS_HOME, "logs"),
    socketPath: join(MARVIS_HOME, "marvis.sock"),
  },
  logging: {
    level: "info",
    format: "text",
  },
  plugins: {},
  aliases: {},
};
```

**Step 5: Run tests to verify they pass**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: All tests PASS

**Step 6: Run typecheck**

Run:
```bash
pnpm typecheck
```

Expected: No errors

**Step 7: Commit**

```bash
git add packages/core/src/types/index.ts packages/core/src/core/config.ts packages/core/tests/core/config.test.ts
git commit -m "feat(config): expand MarvisConfig with paths, logging, plugins, aliases"
```

---

## Task 3: Create TypeBox Config Schema

**Files:**
- Create: `packages/core/src/core/config-schema.ts`
- Test: `packages/core/tests/core/config-schema.test.ts`

**Step 1: Write failing test for schema validation**

Create `packages/core/tests/core/config-schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { MarvisConfigSchema } from "../../src/core/config-schema.js";
import { DEFAULT_CONFIG } from "../../src/core/config.js";

describe("MarvisConfigSchema", () => {
  it("should validate DEFAULT_CONFIG", () => {
    const result = Value.Check(MarvisConfigSchema, DEFAULT_CONFIG);
    expect(result).toBe(true);
  });

  it("should reject invalid provider", () => {
    const invalid = {
      ...DEFAULT_CONFIG,
      llm: { ...DEFAULT_CONFIG.llm, provider: "invalid" },
    };
    const result = Value.Check(MarvisConfigSchema, invalid);
    expect(result).toBe(false);
  });

  it("should reject invalid log level", () => {
    const invalid = {
      ...DEFAULT_CONFIG,
      logging: { ...DEFAULT_CONFIG.logging, level: "verbose" },
    };
    const result = Value.Check(MarvisConfigSchema, invalid);
    expect(result).toBe(false);
  });

  it("should allow optional fields to be missing", () => {
    const config = { ...DEFAULT_CONFIG };
    // fallbackProvider is optional
    delete (config.llm as any).fallbackProvider;
    const result = Value.Check(MarvisConfigSchema, config);
    expect(result).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config-schema.test.ts
```

Expected: FAIL - Cannot find module `config-schema.js`

**Step 3: Create config-schema.ts**

Create `packages/core/src/core/config-schema.ts`:

```typescript
import { Type, Static } from "@sinclair/typebox";

const ProviderSchema = Type.Union([
  Type.Literal("openai"),
  Type.Literal("anthropic"),
  Type.Literal("google"),
]);

const LogLevelSchema = Type.Union([
  Type.Literal("debug"),
  Type.Literal("info"),
  Type.Literal("warn"),
  Type.Literal("error"),
]);

const LogFormatSchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("json"),
]);

const DangerThresholdSchema = Type.Union([
  Type.Literal("moderate"),
  Type.Literal("dangerous"),
]);

export const MarvisConfigSchema = Type.Object({
  llm: Type.Object({
    provider: ProviderSchema,
    model: Type.String(),
    fallbackProvider: Type.Optional(ProviderSchema),
    fallbackModel: Type.Optional(Type.String()),
  }),
  tools: Type.Object({
    confirmDangerous: Type.Boolean(),
    dangerThreshold: DangerThresholdSchema,
  }),
  system: Type.Object({
    systemPrompt: Type.String(),
  }),
  paths: Type.Object({
    dataDir: Type.String(),
    logDir: Type.String(),
    socketPath: Type.String(),
  }),
  logging: Type.Object({
    level: LogLevelSchema,
    format: LogFormatSchema,
    file: Type.Optional(Type.String()),
  }),
  plugins: Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
  aliases: Type.Record(Type.String(), Type.String()),
});

export type MarvisConfigFromSchema = Static<typeof MarvisConfigSchema>;
```

**Step 4: Run tests to verify they pass**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config-schema.test.ts
```

Expected: All 4 tests PASS

**Step 5: Update core barrel export**

Add to `packages/core/src/core/index.ts`:

```typescript
export * from "./config-schema.js";
```

**Step 6: Commit**

```bash
git add packages/core/src/core/config-schema.ts packages/core/tests/core/config-schema.test.ts packages/core/src/core/index.ts
git commit -m "feat(config): add TypeBox schema for config validation"
```

---

## Task 4: Implement ConfigError Class

**Files:**
- Create: `packages/core/src/core/config-error.ts`
- Test: `packages/core/tests/core/config-error.test.ts`

**Step 1: Write failing test**

Create `packages/core/tests/core/config-error.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ConfigError } from "../../src/core/config-error.js";

describe("ConfigError", () => {
  it("should format error with path and source", () => {
    const error = new ConfigError(
      "llm.provider",
      '"openai" | "anthropic" | "google"',
      "invalid",
      "~/.marvis/config.toml"
    );
    expect(error.message).toContain("llm.provider");
    expect(error.message).toContain("invalid");
    expect(error.message).toContain("config.toml");
  });

  it("should be instanceof Error", () => {
    const error = new ConfigError("path", "expected", "received", "source");
    expect(error).toBeInstanceOf(Error);
  });

  it("should have name ConfigError", () => {
    const error = new ConfigError("path", "expected", "received", "source");
    expect(error.name).toBe("ConfigError");
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config-error.test.ts
```

Expected: FAIL - Cannot find module

**Step 3: Implement ConfigError**

Create `packages/core/src/core/config-error.ts`:

```typescript
export class ConfigError extends Error {
  constructor(
    public readonly path: string,
    public readonly expected: string,
    public readonly received: string,
    public readonly source: string
  ) {
    const message = `ConfigError: Invalid value at '${path}'
  Expected: ${expected}
  Received: ${JSON.stringify(received)}
  Source: ${source}`;
    super(message);
    this.name = "ConfigError";
  }
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config-error.test.ts
```

Expected: All 3 tests PASS

**Step 5: Export from core barrel**

Add to `packages/core/src/core/index.ts`:

```typescript
export * from "./config-error.js";
```

**Step 6: Commit**

```bash
git add packages/core/src/core/config-error.ts packages/core/tests/core/config-error.test.ts packages/core/src/core/index.ts
git commit -m "feat(config): add ConfigError class for detailed error reporting"
```

---

## Task 5: Implement TOML Parsing

**Files:**
- Modify: `packages/core/src/core/config.ts`
- Test: `packages/core/tests/core/config.test.ts`

**Step 1: Write failing test for TOML parsing**

Add to `packages/core/tests/core/config.test.ts`:

```typescript
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("TOML Config Loading", () => {
  const testDir = join(tmpdir(), "marvis-test-" + Date.now());
  const configPath = join(testDir, "config.toml");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it("should parse TOML config file", () => {
    writeFileSync(configPath, `
[llm]
provider = "openai"
model = "gpt-4o"

[tools]
confirm_dangerous = false
danger_threshold = "moderate"
`);
    process.env.MARVIS_CONFIG = configPath;
    const config = loadConfig();
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4o");
    expect(config.tools.confirmDangerous).toBe(false);
    expect(config.tools.dangerThreshold).toBe("moderate");
    delete process.env.MARVIS_CONFIG;
  });

  it("should throw on invalid TOML syntax", () => {
    writeFileSync(configPath, `
[llm
provider = "openai"
`);
    process.env.MARVIS_CONFIG = configPath;
    expect(() => loadConfig()).toThrow();
    delete process.env.MARVIS_CONFIG;
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: FAIL - TOML parsing not implemented

**Step 3: Implement parseTomlConfig**

Update `packages/core/src/core/config.ts`:

```typescript
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { parse as parseToml } from "smol-toml";
import { type MarvisConfig } from "../types/index.js";

const MARVIS_HOME = join(homedir(), ".marvis");

export const DEFAULT_CONFIG: MarvisConfig = {
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-0",
  },
  tools: {
    confirmDangerous: true,
    dangerThreshold: "dangerous",
  },
  system: {
    systemPrompt: `You are Marvis, a helpful personal AI assistant running on the user's local machine.

You have access to tools that let you interact with the system. Use them when appropriate to help the user.

Be concise but thorough. When executing commands or making changes, explain what you're doing.`,
  },
  paths: {
    dataDir: join(MARVIS_HOME, "data"),
    logDir: join(MARVIS_HOME, "logs"),
    socketPath: join(MARVIS_HOME, "marvis.sock"),
  },
  logging: {
    level: "info",
    format: "text",
  },
  plugins: {},
  aliases: {},
};

const VALID_PROVIDERS = ["openai", "anthropic", "google"] as const;
const VALID_THRESHOLDS = ["moderate", "dangerous"] as const;
const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const VALID_LOG_FORMATS = ["text", "json"] as const;

export function getConfigPath(): string {
  return process.env.MARVIS_CONFIG || join(MARVIS_HOME, "config.toml");
}

interface TomlConfig {
  llm?: {
    provider?: string;
    model?: string;
    fallback_provider?: string;
    fallback_model?: string;
  };
  tools?: {
    confirm_dangerous?: boolean;
    danger_threshold?: string;
  };
  system?: {
    system_prompt?: string;
  };
  paths?: {
    data_dir?: string;
    log_dir?: string;
    socket_path?: string;
  };
  logging?: {
    level?: string;
    format?: string;
    file?: string;
  };
  plugins?: Record<string, Record<string, unknown>>;
  aliases?: Record<string, string>;
}

function parseTomlConfig(path: string): Partial<MarvisConfig> {
  if (!existsSync(path)) {
    return {};
  }

  const content = readFileSync(path, "utf-8");
  const toml = parseToml(content) as TomlConfig;
  const result: Partial<MarvisConfig> = {};

  if (toml.llm) {
    result.llm = {
      provider: (toml.llm.provider as MarvisConfig["llm"]["provider"]) ?? DEFAULT_CONFIG.llm.provider,
      model: toml.llm.model ?? DEFAULT_CONFIG.llm.model,
      ...(toml.llm.fallback_provider && { fallbackProvider: toml.llm.fallback_provider as MarvisConfig["llm"]["provider"] }),
      ...(toml.llm.fallback_model && { fallbackModel: toml.llm.fallback_model }),
    };
  }

  if (toml.tools) {
    result.tools = {
      confirmDangerous: toml.tools.confirm_dangerous ?? DEFAULT_CONFIG.tools.confirmDangerous,
      dangerThreshold: (toml.tools.danger_threshold as MarvisConfig["tools"]["dangerThreshold"]) ?? DEFAULT_CONFIG.tools.dangerThreshold,
    };
  }

  if (toml.system) {
    result.system = {
      systemPrompt: toml.system.system_prompt ?? DEFAULT_CONFIG.system.systemPrompt,
    };
  }

  if (toml.paths) {
    result.paths = {
      dataDir: toml.paths.data_dir ?? DEFAULT_CONFIG.paths.dataDir,
      logDir: toml.paths.log_dir ?? DEFAULT_CONFIG.paths.logDir,
      socketPath: toml.paths.socket_path ?? DEFAULT_CONFIG.paths.socketPath,
    };
  }

  if (toml.logging) {
    result.logging = {
      level: (toml.logging.level as MarvisConfig["logging"]["level"]) ?? DEFAULT_CONFIG.logging.level,
      format: (toml.logging.format as MarvisConfig["logging"]["format"]) ?? DEFAULT_CONFIG.logging.format,
      ...(toml.logging.file && { file: toml.logging.file }),
    };
  }

  if (toml.plugins) {
    result.plugins = toml.plugins;
  }

  if (toml.aliases) {
    result.aliases = toml.aliases;
  }

  return result;
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    if (sourceValue !== undefined) {
      if (
        typeof sourceValue === "object" &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof result[key] === "object" &&
        result[key] !== null
      ) {
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        ) as T[keyof T];
      } else {
        result[key] = sourceValue as T[keyof T];
      }
    }
  }
  return result;
}

export function loadConfig(): MarvisConfig {
  // Start with defaults
  let config = structuredClone(DEFAULT_CONFIG);

  // Load TOML config
  const configPath = getConfigPath();
  const tomlConfig = parseTomlConfig(configPath);
  config = deepMerge(config, tomlConfig);

  // Apply env var overrides
  if (process.env.MARVIS_PROVIDER) {
    if (!VALID_PROVIDERS.includes(process.env.MARVIS_PROVIDER as any)) {
      throw new Error(
        `Invalid MARVIS_PROVIDER: ${process.env.MARVIS_PROVIDER}. Valid values: ${VALID_PROVIDERS.join(", ")}`
      );
    }
    config.llm.provider = process.env.MARVIS_PROVIDER as MarvisConfig["llm"]["provider"];
  }

  if (process.env.MARVIS_MODEL) {
    config.llm.model = process.env.MARVIS_MODEL;
  }

  if (process.env.MARVIS_CONFIRM_DANGEROUS) {
    config.tools.confirmDangerous = process.env.MARVIS_CONFIRM_DANGEROUS !== "false";
  }

  if (process.env.MARVIS_DANGER_THRESHOLD) {
    if (!VALID_THRESHOLDS.includes(process.env.MARVIS_DANGER_THRESHOLD as any)) {
      throw new Error(
        `Invalid MARVIS_DANGER_THRESHOLD: ${process.env.MARVIS_DANGER_THRESHOLD}. Valid values: ${VALID_THRESHOLDS.join(", ")}`
      );
    }
    config.tools.dangerThreshold = process.env.MARVIS_DANGER_THRESHOLD as MarvisConfig["tools"]["dangerThreshold"];
  }

  if (process.env.MARVIS_DATA_DIR) {
    config.paths.dataDir = process.env.MARVIS_DATA_DIR;
  }

  if (process.env.MARVIS_LOG_DIR) {
    config.paths.logDir = process.env.MARVIS_LOG_DIR;
  }

  if (process.env.MARVIS_SOCKET_PATH) {
    config.paths.socketPath = process.env.MARVIS_SOCKET_PATH;
  }

  if (process.env.MARVIS_LOG_LEVEL) {
    if (!VALID_LOG_LEVELS.includes(process.env.MARVIS_LOG_LEVEL as any)) {
      throw new Error(
        `Invalid MARVIS_LOG_LEVEL: ${process.env.MARVIS_LOG_LEVEL}. Valid values: ${VALID_LOG_LEVELS.join(", ")}`
      );
    }
    config.logging.level = process.env.MARVIS_LOG_LEVEL as MarvisConfig["logging"]["level"];
  }

  if (process.env.MARVIS_LOG_FORMAT) {
    if (!VALID_LOG_FORMATS.includes(process.env.MARVIS_LOG_FORMAT as any)) {
      throw new Error(
        `Invalid MARVIS_LOG_FORMAT: ${process.env.MARVIS_LOG_FORMAT}. Valid values: ${VALID_LOG_FORMATS.join(", ")}`
      );
    }
    config.logging.format = process.env.MARVIS_LOG_FORMAT as MarvisConfig["logging"]["format"];
  }

  if (process.env.MARVIS_LOG_FILE) {
    config.logging.file = process.env.MARVIS_LOG_FILE;
  }

  return config;
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/core/src/core/config.ts packages/core/tests/core/config.test.ts
git commit -m "feat(config): implement TOML config parsing with smol-toml"
```

---

## Task 6: Implement Auto-Create Config

**Files:**
- Modify: `packages/core/src/core/config.ts`
- Test: `packages/core/tests/core/config.test.ts`

**Step 1: Write failing test for auto-creation**

Add to `packages/core/tests/core/config.test.ts`:

```typescript
import { ensureConfigExists, getConfigPath, DEFAULT_TOML_TEMPLATE } from "../../src/core/config.js";

describe("Config Auto-Creation", () => {
  const testDir = join(tmpdir(), "marvis-autocreate-" + Date.now());
  const configPath = join(testDir, "config.toml");

  beforeEach(() => {
    process.env.MARVIS_CONFIG = configPath;
  });

  afterEach(() => {
    delete process.env.MARVIS_CONFIG;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it("should create config file if missing", () => {
    expect(existsSync(configPath)).toBe(false);
    ensureConfigExists();
    expect(existsSync(configPath)).toBe(true);
  });

  it("should create parent directories", () => {
    expect(existsSync(testDir)).toBe(false);
    ensureConfigExists();
    expect(existsSync(testDir)).toBe(true);
  });

  it("should write commented default template", () => {
    ensureConfigExists();
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("[llm]");
    expect(content).toContain("provider");
    expect(content).toContain("#"); // Has comments
  });

  it("should not overwrite existing config", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(configPath, "[llm]\nmodel = \"custom\"");
    ensureConfigExists();
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("custom");
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: FAIL - `ensureConfigExists` not exported

**Step 3: Implement ensureConfigExists and DEFAULT_TOML_TEMPLATE**

Add to `packages/core/src/core/config.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export const DEFAULT_TOML_TEMPLATE = `# Marvis Configuration
# All values shown are defaults. Uncomment and modify as needed.

[llm]
provider = "anthropic"           # "anthropic" | "openai" | "google"
model = "claude-sonnet-4-0"
# fallback_provider = "openai"   # Optional fallback
# fallback_model = "gpt-4o"

[tools]
confirm_dangerous = true         # Require confirmation for dangerous tools
danger_threshold = "dangerous"   # "moderate" | "dangerous"

[system]
# system_prompt = """
# You are Marvis, a helpful personal AI assistant.
# """

[paths]
# data_dir = "~/.marvis/data"
# log_dir = "~/.marvis/logs"
# socket_path = "~/.marvis/marvis.sock"

[logging]
level = "info"                   # "debug" | "info" | "warn" | "error"
format = "text"                  # "text" | "json"
# file = "~/.marvis/logs/marvis.log"

[plugins]
# Per-plugin configuration blocks
# [plugins.shell]
# allowed_commands = ["ls", "cat", "echo"]

[aliases]
# User-defined shortcuts
# quick = "Be extremely concise, one-line answers only"
# code = "You are in coding mode. Output code only, no explanations."
`;

export function ensureConfigExists(): void {
  const configPath = getConfigPath();
  
  if (existsSync(configPath)) {
    return;
  }

  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(configPath, DEFAULT_TOML_TEMPLATE, "utf-8");
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/core/src/core/config.ts packages/core/tests/core/config.test.ts
git commit -m "feat(config): implement auto-creation of config file with defaults"
```

---

## Task 7: Implement Path Expansion

**Files:**
- Modify: `packages/core/src/core/config.ts`
- Test: `packages/core/tests/core/config.test.ts`

**Step 1: Write failing test for path expansion**

Add to `packages/core/tests/core/config.test.ts`:

```typescript
describe("Path Expansion", () => {
  it("should expand ~ in paths from TOML", () => {
    const testDir = join(tmpdir(), "marvis-paths-" + Date.now());
    const configPath = join(testDir, "config.toml");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(configPath, `
[paths]
data_dir = "~/.marvis/data"
log_dir = "~/.marvis/logs"
socket_path = "~/.marvis/marvis.sock"
`);
    process.env.MARVIS_CONFIG = configPath;
    const config = loadConfig();
    expect(config.paths.dataDir).not.toContain("~");
    expect(config.paths.dataDir).toContain(homedir());
    delete process.env.MARVIS_CONFIG;
    rmSync(testDir, { recursive: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: FAIL - path still contains `~`

**Step 3: Implement expandPaths**

Add to `packages/core/src/core/config.ts`:

```typescript
function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

function expandPaths(config: MarvisConfig): MarvisConfig {
  return {
    ...config,
    paths: {
      dataDir: expandPath(config.paths.dataDir),
      logDir: expandPath(config.paths.logDir),
      socketPath: expandPath(config.paths.socketPath),
    },
    logging: {
      ...config.logging,
      ...(config.logging.file && { file: expandPath(config.logging.file) }),
    },
  };
}
```

Then update `loadConfig()` to call `expandPaths` before returning:

```typescript
export function loadConfig(): MarvisConfig {
  // ... existing code ...
  
  // Expand paths (~ -> home directory)
  config = expandPaths(config);

  return config;
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/core/src/core/config.ts packages/core/tests/core/config.test.ts
git commit -m "feat(config): implement path expansion for ~ in paths"
```

---

## Task 8: Implement TypeBox Validation

**Files:**
- Modify: `packages/core/src/core/config.ts`
- Test: `packages/core/tests/core/config.test.ts`

**Step 1: Write failing test for validation**

Add to `packages/core/tests/core/config.test.ts`:

```typescript
import { ConfigError } from "../../src/core/config-error.js";

describe("Config Validation", () => {
  it("should throw ConfigError for invalid provider in TOML", () => {
    const testDir = join(tmpdir(), "marvis-validate-" + Date.now());
    const configPath = join(testDir, "config.toml");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(configPath, `
[llm]
provider = "invalid-provider"
model = "test"
`);
    process.env.MARVIS_CONFIG = configPath;
    expect(() => loadConfig()).toThrow(ConfigError);
    delete process.env.MARVIS_CONFIG;
    rmSync(testDir, { recursive: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: FAIL - does not throw ConfigError

**Step 3: Implement validation**

Add validation to `packages/core/src/core/config.ts`:

```typescript
import { Value } from "@sinclair/typebox/value";
import { MarvisConfigSchema } from "./config-schema.js";
import { ConfigError } from "./config-error.js";

function validateConfig(config: unknown, source: string): MarvisConfig {
  const errors = [...Value.Errors(MarvisConfigSchema, config)];
  if (errors.length > 0) {
    const firstError = errors[0];
    throw new ConfigError(
      firstError.path,
      firstError.message,
      String(firstError.value),
      source
    );
  }
  return config as MarvisConfig;
}
```

Update `loadConfig()` to validate after TOML parsing:

```typescript
export function loadConfig(): MarvisConfig {
  // Start with defaults
  let config = structuredClone(DEFAULT_CONFIG);

  // Load TOML config
  const configPath = getConfigPath();
  const tomlConfig = parseTomlConfig(configPath);
  config = deepMerge(config, tomlConfig);

  // Validate TOML-merged config before env overrides
  if (existsSync(configPath)) {
    validateConfig(config, configPath);
  }

  // ... rest of env var overrides ...

  // Expand paths
  config = expandPaths(config);

  return config;
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/core/src/core/config.ts packages/core/tests/core/config.test.ts
git commit -m "feat(config): add TypeBox validation with ConfigError"
```

---

## Task 9: Add CLI Config Overrides

**Files:**
- Modify: `packages/core/src/core/config.ts`
- Modify: `apps/cli/src/cli/cli.ts`
- Test: `packages/core/tests/core/config.test.ts`

**Step 1: Write failing test for CLI overrides**

Add to `packages/core/tests/core/config.test.ts`:

```typescript
describe("CLI Overrides", () => {
  it("should apply CLI args over env vars", () => {
    process.env.MARVIS_PROVIDER = "openai";
    const config = loadConfig({ provider: "google" });
    expect(config.llm.provider).toBe("google");
  });

  it("should apply logLevel CLI arg", () => {
    const config = loadConfig({ logLevel: "debug" });
    expect(config.logging.level).toBe("debug");
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: FAIL - loadConfig doesn't accept args

**Step 3: Update loadConfig signature**

Modify `packages/core/src/core/config.ts`:

```typescript
export interface CliConfigArgs {
  provider?: string;
  model?: string;
  logLevel?: string;
  config?: string;
  alias?: string;
}

export function loadConfig(cliArgs?: Partial<CliConfigArgs>): MarvisConfig {
  // Start with defaults
  let config = structuredClone(DEFAULT_CONFIG);

  // Override config path from CLI
  const configPath = cliArgs?.config || getConfigPath();
  
  // ... TOML parsing ...

  // ... env var overrides ...

  // Apply CLI arg overrides (highest precedence)
  if (cliArgs?.provider) {
    if (!VALID_PROVIDERS.includes(cliArgs.provider as any)) {
      throw new Error(`Invalid provider: ${cliArgs.provider}. Valid values: ${VALID_PROVIDERS.join(", ")}`);
    }
    config.llm.provider = cliArgs.provider as MarvisConfig["llm"]["provider"];
  }

  if (cliArgs?.model) {
    config.llm.model = cliArgs.model;
  }

  if (cliArgs?.logLevel) {
    if (!VALID_LOG_LEVELS.includes(cliArgs.logLevel as any)) {
      throw new Error(`Invalid log level: ${cliArgs.logLevel}. Valid values: ${VALID_LOG_LEVELS.join(", ")}`);
    }
    config.logging.level = cliArgs.logLevel as MarvisConfig["logging"]["level"];
  }

  // Expand paths
  config = expandPaths(config);

  return config;
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
pnpm test -- --run packages/core/tests/core/config.test.ts
```

Expected: All tests PASS

**Step 5: Update CLI to pass args**

Modify `apps/cli/src/cli/cli.ts` - add options to commands:

```typescript
.command("start")
.option("--provider <provider>", "LLM provider (anthropic, openai, google)")
.option("--model <model>", "LLM model name")
.option("--log-level <level>", "Log level (debug, info, warn, error)")
.option("--config <path>", "Config file path")
```

**Step 6: Run typecheck**

Run:
```bash
pnpm typecheck
```

Expected: No errors

**Step 7: Commit**

```bash
git add packages/core/src/core/config.ts apps/cli/src/cli/cli.ts packages/core/tests/core/config.test.ts
git commit -m "feat(config): add CLI config overrides with highest precedence"
```

---

## Task 10: Update Consumers to Use New Paths

**Files:**
- Modify: `packages/core/src/bin/marvis-daemon.ts`
- Modify: `apps/cli/src/cli/cli.ts`
- Modify: `packages/core/src/daemon/daemon.ts`

**Step 1: Update marvis-daemon.ts**

```typescript
#!/usr/bin/env node
import { MarvisDaemon } from "../daemon/daemon.js";
import { loadConfig, ensureConfigExists } from "../core/config.js";

// Ensure config exists
ensureConfigExists();

const config = loadConfig();

const daemon = new MarvisDaemon({
  socketPath: config.paths.socketPath,
  pidFile: config.paths.dataDir + "/marvis.pid",
  logFile: config.logging.file || config.paths.logDir + "/marvis.log",
  dbPath: config.paths.dataDir + "/marvis.db",
  marvisConfig: config,
});

daemon.start().catch((err) => {
  console.error("Failed to start daemon:", err);
  process.exit(1);
});
```

**Step 2: Update CLI defaults**

Update `apps/cli/src/cli/cli.ts` to use config paths instead of hardcoded defaults.

**Step 3: Run full test suite**

Run:
```bash
pnpm test -- --run
```

Expected: All tests PASS

**Step 4: Run typecheck**

Run:
```bash
pnpm typecheck
```

Expected: No errors

**Step 5: Commit**

```bash
git add packages/core/src/bin/marvis-daemon.ts apps/cli/src/cli/cli.ts packages/core/src/daemon/daemon.ts
git commit -m "refactor: update all consumers to use config paths"
```

---

## Task 11: Integration Test & Final Verification

**Files:**
- Test: `packages/core/tests/core/config.test.ts`

**Step 1: Add integration test**

```typescript
describe("Full Config Integration", () => {
  it("should follow precedence: CLI > env > TOML > defaults", () => {
    const testDir = join(tmpdir(), "marvis-integration-" + Date.now());
    const configPath = join(testDir, "config.toml");
    mkdirSync(testDir, { recursive: true });
    
    // TOML sets provider to openai
    writeFileSync(configPath, `
[llm]
provider = "openai"
model = "toml-model"

[logging]
level = "warn"
`);
    
    // Env sets model to env-model
    process.env.MARVIS_CONFIG = configPath;
    process.env.MARVIS_MODEL = "env-model";
    
    // CLI sets log level to debug
    const config = loadConfig({ logLevel: "debug" });
    
    // Verify precedence
    expect(config.llm.provider).toBe("openai");     // From TOML
    expect(config.llm.model).toBe("env-model");      // From env (overrides TOML)
    expect(config.logging.level).toBe("debug");      // From CLI (overrides env)
    expect(config.tools.confirmDangerous).toBe(true); // From defaults
    
    delete process.env.MARVIS_CONFIG;
    delete process.env.MARVIS_MODEL;
    rmSync(testDir, { recursive: true });
  });
});
```

**Step 2: Run full test suite**

Run:
```bash
pnpm test -- --run
```

Expected: All tests PASS

**Step 3: Run build**

Run:
```bash
pnpm build
```

Expected: Build succeeds

**Step 4: Manual smoke test**

Run:
```bash
# Create test config
mkdir -p ~/.marvis-test
cat > ~/.marvis-test/config.toml << 'EOF'
[llm]
provider = "anthropic"
model = "claude-sonnet-4-0"

[logging]
level = "debug"
EOF

MARVIS_CONFIG=~/.marvis-test/config.toml pnpm cli status
rm -rf ~/.marvis-test
```

**Step 5: Final commit**

```bash
git add packages/core/tests/core/config.test.ts
git commit -m "test: add full config integration test"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add smol-toml dependency |
| 2 | Expand MarvisConfig type with paths, logging, plugins, aliases |
| 3 | Create TypeBox config schema |
| 4 | Implement ConfigError class |
| 5 | Implement TOML parsing |
| 6 | Implement auto-create config |
| 7 | Implement path expansion |
| 8 | Implement TypeBox validation |
| 9 | Add CLI config overrides |
| 10 | Update consumers to use new paths |
| 11 | Integration test & final verification |

**Total: 11 tasks**
