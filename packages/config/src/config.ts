import { Value } from "@sinclair/typebox/value";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { MarvisConfig } from "./types";
import { ConfigError } from "./config-error";
import { MarvisConfigSchema } from "./types";
import type { PluginConfigRegistry } from "./plugin-registry";
export interface CliConfigArgs {
  provider?: string;
  model?: string;
  logLevel?: string;
  config?: string;
}

const MARVIS_HOME = join(homedir(), ".marvis");
export const DEFAULT_TOML_TEMPLATE = `# Marvis Configuration
# Documentation: https://github.com/yourusername/marvis#configuration

# LLM Provider Settings
[llm]
provider = "anthropic"  # Options: anthropic, openai, google, ...
model = "claude-sonnet-4-0"
# fallback_provider = "openai"
# fallback_model = "gpt-4o"

# Tool Behavior
[tools]
confirm_dangerous = true  # Ask before running destructive commands
danger_threshold = "dangerous"  # Options: moderate, dangerous

# System Prompt (optional)
# [system]
# system_prompt = "You are Marvis, a helpful AI assistant."

# File Paths (uses ~/.marvis by default)
[paths]
# data_dir = "~/.marvis/data"
# log_dir = "~/.marvis/logs"
# socket_path = "~/.marvis/marvis.sock"

# Logging Configuration
[logging]
level = "info"  # Options: debug, info, warn, error
format = "text"  # Options: text, json
# file = "~/.marvis/logs/marvis.log"

# Plugin Configuration (plugin-specific settings)
[plugins]
# [plugins.shell]
# allowed_commands = ["ls", "cat", "echo"]

# Command Aliases
[aliases]
# status = "What's the current system status?"
# weather = "What's the weather like today?"
`;

export function ensureConfigExists(): void {
  const configPath = getConfigPath();

  if (existsSync(configPath)) {
    return;
  }

  const configDir = configPath.substring(0, configPath.lastIndexOf("/"));
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  writeFileSync(configPath, DEFAULT_TOML_TEMPLATE, "utf-8");
}

export interface EnsureDirectoriesOptions {
  dataDir: string;
  logDir: string;
}

export function ensureDirectoriesExist(options: EnsureDirectoriesOptions): void {
  mkdirSync(options.dataDir, { recursive: true });
  mkdirSync(options.logDir, { recursive: true });
}
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

export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
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
      provider:
        (toml.llm.provider as MarvisConfig["llm"]["provider"]) ?? DEFAULT_CONFIG.llm.provider,
      model: toml.llm.model ?? DEFAULT_CONFIG.llm.model,
      ...(toml.llm.fallback_provider && {
        fallbackProvider: toml.llm.fallback_provider as MarvisConfig["llm"]["provider"],
      }),
      ...(toml.llm.fallback_model && {
        fallbackModel: toml.llm.fallback_model,
      }),
    };
  }

  if (toml.tools) {
    result.tools = {
      confirmDangerous: toml.tools.confirm_dangerous ?? DEFAULT_CONFIG.tools.confirmDangerous,
      dangerThreshold:
        (toml.tools.danger_threshold as MarvisConfig["tools"]["dangerThreshold"]) ??
        DEFAULT_CONFIG.tools.dangerThreshold,
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
      level:
        (toml.logging.level as MarvisConfig["logging"]["level"]) ?? DEFAULT_CONFIG.logging.level,
      format:
        (toml.logging.format as MarvisConfig["logging"]["format"]) ?? DEFAULT_CONFIG.logging.format,
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

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
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
          sourceValue as Record<string, unknown>,
        ) as T[keyof T];
      } else {
        result[key] = sourceValue as T[keyof T];
      }
    }
  }
  return result;
}

function validateConfig(config: unknown, source: string): void {
  if (!Value.Check(MarvisConfigSchema, config)) {
    const errors = [...Value.Errors(MarvisConfigSchema, config)];
    if (errors.length > 0) {
      const error = errors[0];
      throw new ConfigError(error.path, error.message, String(error.value), source);
    }
  }
}

export function loadConfig(cliArgs?: CliConfigArgs, registry?: PluginConfigRegistry): MarvisConfig {
  let config = structuredClone(DEFAULT_CONFIG);

  const configPath = cliArgs?.config || getConfigPath();
  const tomlConfig = parseTomlConfig(configPath);
  config = deepMerge(config, tomlConfig as Partial<MarvisConfig>);
  // Validate config after merging TOML (before env var overrides)
  validateConfig(config, `TOML config (${configPath})`);

  if (process.env.MARVIS_PROVIDER) {
    if (!VALID_PROVIDERS.includes(process.env.MARVIS_PROVIDER as any)) {
      throw new Error(
        `Invalid MARVIS_PROVIDER: ${process.env.MARVIS_PROVIDER}. Valid values: ${VALID_PROVIDERS.join(", ")}`,
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
        `Invalid MARVIS_DANGER_THRESHOLD: ${process.env.MARVIS_DANGER_THRESHOLD}. Valid values: ${VALID_THRESHOLDS.join(", ")}`,
      );
    }
    config.tools.dangerThreshold = process.env
      .MARVIS_DANGER_THRESHOLD as MarvisConfig["tools"]["dangerThreshold"];
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
        `Invalid MARVIS_LOG_LEVEL: ${process.env.MARVIS_LOG_LEVEL}. Valid values: ${VALID_LOG_LEVELS.join(", ")}`,
      );
    }
    config.logging.level = process.env.MARVIS_LOG_LEVEL as MarvisConfig["logging"]["level"];
  }

  if (process.env.MARVIS_LOG_FORMAT) {
    if (!VALID_LOG_FORMATS.includes(process.env.MARVIS_LOG_FORMAT as any)) {
      throw new Error(
        `Invalid MARVIS_LOG_FORMAT: ${process.env.MARVIS_LOG_FORMAT}. Valid values: ${VALID_LOG_FORMATS.join(", ")}`,
      );
    }
    config.logging.format = process.env.MARVIS_LOG_FORMAT as MarvisConfig["logging"]["format"];
  }

  if (process.env.MARVIS_LOG_FILE) {
    config.logging.file = process.env.MARVIS_LOG_FILE;
  }

  // Apply CLI arg overrides (highest precedence)
  if (cliArgs?.provider) {
    if (!VALID_PROVIDERS.includes(cliArgs.provider as any)) {
      throw new Error(
        `Invalid provider: ${cliArgs.provider}. Valid values: ${VALID_PROVIDERS.join(", ")}`,
      );
    }
    config.llm.provider = cliArgs.provider as MarvisConfig["llm"]["provider"];
  }

  if (cliArgs?.model) {
    config.llm.model = cliArgs.model;
  }

  if (cliArgs?.logLevel) {
    if (!VALID_LOG_LEVELS.includes(cliArgs.logLevel as any)) {
      throw new Error(
        `Invalid log level: ${cliArgs.logLevel}. Valid values: ${VALID_LOG_LEVELS.join(", ")}`,
      );
    }
    config.logging.level = cliArgs.logLevel as MarvisConfig["logging"]["level"];
  }

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

  return expandPaths(config);
}

/**
 * Generate a full config file template, optionally including plugin sections
 * from a registry.
 */
export function generateConfigTemplate(registry?: PluginConfigRegistry): string {
  let template = DEFAULT_TOML_TEMPLATE;

  if (registry && registry.listRegistered().length > 0) {
    // Find the [plugins] section and replace its placeholder content
    const pluginSectionStart = template.indexOf("[plugins]");
    if (pluginSectionStart !== -1) {
      // Find the next top-level section after [plugins]
      const afterPlugins = template.indexOf("\n[", pluginSectionStart + 1);
      const pluginSectionEnd = afterPlugins !== -1 ? afterPlugins + 1 : template.length;

      const pluginToml = `[plugins]\n${registry.generateAllPluginToml()}\n\n`;
      template =
        template.slice(0, pluginSectionStart) + pluginToml + template.slice(pluginSectionEnd);
    }
  }

  return template;
}
