// Core module barrel export

// Config (re-exported from @marvis/config for backward compatibility)
export {
  loadConfig,
  ensureConfigExists,
  ensureDirectoriesExist,
  expandPath,
  getConfigPath,
  DEFAULT_CONFIG,
  DEFAULT_TOML_TEMPLATE,
  ConfigError,
  MarvisConfigSchema,
  type CliConfigArgs,
  type EnsureDirectoriesOptions,
  type MarvisConfigFromSchema,
} from "@marvis/config";

export * from "./marvis";
export * from "./memory";
