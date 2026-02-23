# Marvis Configuration System Design

> **⚠️ Post-Migration Note (2026-02-27):** This document was written before the monorepo migration.
> The project has been restructured from a flat `src/` layout into a pnpm monorepo with:
> - `packages/core/` (@marvis/core) — Core logic, daemon, memory, plugin system, types
> - `packages/plugin-shell/` (@marvis/plugin-shell) — Shell command plugin
> - `apps/cli/` (@marvis/cli) — CLI interface
>
> All file paths, import paths, and build commands in this document have been updated to reflect the new structure.
> Build: `pnpm build` (Turborepo) | Test: `pnpm test` | Lint: `pnpm lint` (Biome.js)

**Date:** 2026-02-23  
**Status:** Approved  
**Author:** Sisyphus + User collaboration

## Overview

Replace the current environment-variable-only configuration with a comprehensive TOML-based config system. The config file lives at `~/.marvis/config.toml` with full precedence chain support.

## Requirements

| Requirement | Decision |
|-------------|----------|
| Config format | TOML (`config.toml`) |
| Location | `~/.marvis/` |
| Precedence | CLI flags > Env vars > TOML file > Defaults |
| Sections | llm, tools, system, paths, plugins, logging, aliases |
| Missing file behavior | Auto-create with documented defaults |
| Parser | smol-toml (fastest, zero deps, TOML 1.1) |
| Validation | TypeBox (already in project) |

## Config File Structure

**Location:** `~/.marvis/config.toml`

```toml
# Marvis Configuration
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
system_prompt = """
You are Marvis, a helpful personal AI assistant running on the user's local machine.
You have access to tools that let you interact with the system. Use them when appropriate.
Be concise but thorough. When executing commands or making changes, explain what you're doing.
"""

[paths]
data_dir = "~/.marvis/data"      # Database, conversation history
log_dir = "~/.marvis/logs"       # Log files
socket_path = "~/.marvis/marvis.sock"

[logging]
level = "info"                   # "debug" | "info" | "warn" | "error"
format = "text"                  # "text" | "json"
# file = "~/.marvis/logs/marvis.log"  # Optional, logs to stderr if not set

[plugins]
# Per-plugin configuration blocks
# [plugins.shell]
# allowed_commands = ["ls", "cat", "echo"]
# blocked_commands = ["rm -rf"]

[aliases]
# User-defined shortcuts
# quick = "Be extremely concise, one-line answers only"
# code = "You are in coding mode. Output code only, no explanations."
```

## TypeScript Types

### Expanded MarvisConfig Interface

```typescript
// packages/core/src/types/index.ts

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

### TypeBox Schema for Validation

```typescript
// packages/core/src/core/config-schema.ts
import { Type, Static } from "@sinclair/typebox";

export const MarvisConfigSchema = Type.Object({
  llm: Type.Object({
    provider: Type.Union([
      Type.Literal("openai"),
      Type.Literal("anthropic"),
      Type.Literal("google")
    ]),
    model: Type.String(),
    fallbackProvider: Type.Optional(Type.Union([
      Type.Literal("openai"),
      Type.Literal("anthropic"),
      Type.Literal("google")
    ])),
    fallbackModel: Type.Optional(Type.String()),
  }),
  tools: Type.Object({
    confirmDangerous: Type.Boolean(),
    dangerThreshold: Type.Union([
      Type.Literal("moderate"),
      Type.Literal("dangerous")
    ]),
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
    level: Type.Union([
      Type.Literal("debug"),
      Type.Literal("info"),
      Type.Literal("warn"),
      Type.Literal("error")
    ]),
    format: Type.Union([
      Type.Literal("text"),
      Type.Literal("json")
    ]),
    file: Type.Optional(Type.String()),
  }),
  plugins: Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
  aliases: Type.Record(Type.String(), Type.String()),
});

export type MarvisConfigFromSchema = Static<typeof MarvisConfigSchema>;
```

## Config Loading Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    loadConfig(cliArgs?)                         │
├─────────────────────────────────────────────────────────────────┤
│  1. Start with DEFAULT_CONFIG                                  │
│  2. Check ~/.marvis/config.toml exists                         │
│     └─ If not: create with defaults + comments                 │
│  3. Parse TOML file with smol-toml                             │
│  4. Deep merge: defaults ← toml                                │
│  5. Apply env var overrides (MARVIS_*)                         │
│  6. Apply CLI arg overrides (if provided)                      │
│  7. Expand paths (~ → home directory)                          │
│  8. Validate with TypeBox schema                               │
│  9. Return validated MarvisConfig                              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Functions

```typescript
// packages/core/src/core/config.ts

// Public API
export function loadConfig(cliArgs?: Partial<CliConfigArgs>): MarvisConfig;
export function getConfigPath(): string;  // Returns ~/.marvis/config.toml
export function ensureConfigExists(): void;  // Creates default if missing
export function writeDefaultConfig(path: string): void;  // Write commented TOML

// Internal helpers
function parseTomlConfig(path: string): Partial<MarvisConfig>;
function applyEnvOverrides(config: MarvisConfig): MarvisConfig;
function applyCliOverrides(config: MarvisConfig, args: Partial<CliConfigArgs>): MarvisConfig;
function expandPaths(config: MarvisConfig): MarvisConfig;
function validateConfig(config: unknown): MarvisConfig;  // TypeBox validation
```

## Environment Variable Mapping

Preserve existing env vars, add new ones for new sections:

| Env Variable | Config Path | Type |
|-------------|-------------|------|
| `MARVIS_PROVIDER` | `llm.provider` | string |
| `MARVIS_MODEL` | `llm.model` | string |
| `MARVIS_CONFIRM_DANGEROUS` | `tools.confirmDangerous` | boolean |
| `MARVIS_DANGER_THRESHOLD` | `tools.dangerThreshold` | string |
| `MARVIS_DATA_DIR` | `paths.dataDir` | string |
| `MARVIS_LOG_DIR` | `paths.logDir` | string |
| `MARVIS_SOCKET_PATH` | `paths.socketPath` | string |
| `MARVIS_LOG_LEVEL` | `logging.level` | string |
| `MARVIS_LOG_FORMAT` | `logging.format` | string |
| `MARVIS_LOG_FILE` | `logging.file` | string |
| `MARVIS_CONFIG` | (override config file path) | string |

## CLI Integration

### New CLI Flags

```bash
marvis start --provider openai --model gpt-4o --log-level debug
marvis chat --alias quick  # Uses aliases.quick as system prompt modifier
```

### CLI Args Structure

```typescript
interface CliConfigArgs {
  provider?: string;
  model?: string;
  logLevel?: string;
  config?: string;  // Override config file path
  alias?: string;   // Use a defined alias
}
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Missing config file | Auto-create with defaults, log info message |
| Invalid TOML syntax | Throw with line/column from smol-toml error |
| Schema validation failure | Throw with path to invalid field + expected type |
| Invalid env var value | Throw with var name + valid options |
| Missing required field | Throw with field path |

### Error Format

```
ConfigError: Invalid value at 'llm.provider'
  Expected: "openai" | "anthropic" | "google"
  Received: "invalid"
  Source: ~/.marvis/config.toml
```

## Dependencies

### New Dependencies

- `smol-toml` - TOML parser (zero deps, 103 kB unpacked, TOML 1.1 compliant)

### Existing Dependencies (reused)

- `@sinclair/typebox` - Schema validation (already in project)

## Directory Structure Changes

```
~/.marvis/
├── config.toml          # Main configuration file
├── data/                # Database, conversation history
│   └── marvis.db
├── logs/                # Log files
│   └── marvis.log
└── marvis.sock          # Unix socket (when running)
```

## Migration Path

1. Existing env-var-only users: Continue working (env vars override defaults)
2. First run with new version: Auto-creates `~/.marvis/config.toml`
3. No breaking changes: All existing env vars still work with same precedence

## Testing Strategy

1. **Unit tests for each layer:**
   - `parseTomlConfig()` - TOML parsing
   - `applyEnvOverrides()` - Env var application
   - `applyCliOverrides()` - CLI arg application
   - `validateConfig()` - TypeBox validation
   - `expandPaths()` - Path expansion

2. **Integration tests:**
   - Full `loadConfig()` with all layers
   - Auto-creation of missing config file
   - Error scenarios (invalid TOML, validation failures)

3. **Preserve existing tests:**
   - All current `config.test.ts` tests should pass unchanged
