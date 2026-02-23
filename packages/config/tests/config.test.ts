import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, DEFAULT_CONFIG } from "../src/config";
import { type MarvisConfig } from "../src/types";

describe("Config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return default config when no env vars set", () => {
    const config = loadConfig({ config: "/nonexistent/config.toml" });
    expect(config.llm.provider).toBe("anthropic");
    expect(config.llm.model).toBe("claude-sonnet-4-0");
    expect(config.tools.confirmDangerous).toBe(true);
  });

  it("should override provider from env var", () => {
    process.env.MARVIS_PROVIDER = "openai";
    process.env.MARVIS_MODEL = "gpt-4o";
    const config = loadConfig();
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4o");
  });

  it("should override tool confirmation from env var", () => {
    process.env.MARVIS_CONFIRM_DANGEROUS = "false";
    const config = loadConfig();
    expect(config.tools.confirmDangerous).toBe(false);
  });

  it("should throw error for invalid provider", () => {
    process.env.MARVIS_PROVIDER = "invalid";
    expect(() => loadConfig()).toThrow(/Invalid MARVIS_PROVIDER: invalid/);
  });

  it("should throw error for invalid danger threshold", () => {
    process.env.MARVIS_DANGER_THRESHOLD = "invalid";
    expect(() => loadConfig()).toThrow(
      /Invalid MARVIS_DANGER_THRESHOLD: invalid/,
    );
  });

  it("should accept valid danger thresholds", () => {
    process.env.MARVIS_DANGER_THRESHOLD = "moderate";
    const config = loadConfig();
    expect(config.tools.dangerThreshold).toBe("moderate");
  });

  it("should parse confirmDangerous correctly for true-like values", () => {
    process.env.MARVIS_CONFIRM_DANGEROUS = "true";
    const config = loadConfig();
    expect(config.tools.confirmDangerous).toBe(true);
  });

  it("should parse confirmDangerous correctly for any non-false value", () => {
    process.env.MARVIS_CONFIRM_DANGEROUS = "yes";
    const config = loadConfig();
    expect(config.tools.confirmDangerous).toBe(true);
  });

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
    const config = loadConfig({ config: "/nonexistent/config.toml" });
    expect(config.plugins).toEqual({});
    expect(config.aliases).toEqual({});
  });
});

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
    delete process.env.MARVIS_CONFIG;
  });

  it("should parse TOML config file", () => {
    writeFileSync(
      configPath,
      `
[llm]
provider = "openai"
model = "gpt-4o"

[tools]
confirm_dangerous = false
danger_threshold = "moderate"
`,
    );
    process.env.MARVIS_CONFIG = configPath;
    const config = loadConfig();
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4o");
    expect(config.tools.confirmDangerous).toBe(false);
    expect(config.tools.dangerThreshold).toBe("moderate");
  });

  it("should throw on invalid TOML syntax", () => {
    writeFileSync(
      configPath,
      `
[llm
provider = "openai"
`,
    );
    process.env.MARVIS_CONFIG = configPath;
    expect(() => loadConfig()).toThrow();
  });
});

import {
  getConfigPath,
  ensureConfigExists,
  DEFAULT_TOML_TEMPLATE,
} from "../src/config";
import { readFileSync } from "fs";

describe("ensureConfigExists", () => {
  const testDir = join(tmpdir(), "marvis-ensure-test-" + Date.now());
  const configPath = join(testDir, "config.toml");

  beforeEach(() => {
    process.env.MARVIS_CONFIG = configPath;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    delete process.env.MARVIS_CONFIG;
  });

  it("should create config file if it does not exist", () => {
    expect(existsSync(configPath)).toBe(false);
    ensureConfigExists();
    expect(existsSync(configPath)).toBe(true);
  });

  it("should create parent directories if they do not exist", () => {
    expect(existsSync(testDir)).toBe(false);
    ensureConfigExists();
    expect(existsSync(testDir)).toBe(true);
    expect(existsSync(configPath)).toBe(true);
  });

  it("should not overwrite existing config file", () => {
    mkdirSync(testDir, { recursive: true });
    const customContent = '# My custom config\n[llm]\nprovider = "openai"\n';
    writeFileSync(configPath, customContent);
    ensureConfigExists();
    const content = readFileSync(configPath, "utf-8");
    expect(content).toBe(customContent);
  });

  it("should write DEFAULT_TOML_TEMPLATE when creating new config", () => {
    ensureConfigExists();
    const content = readFileSync(configPath, "utf-8");
    expect(content).toBe(DEFAULT_TOML_TEMPLATE);
  });
});

describe("DEFAULT_TOML_TEMPLATE", () => {
  it("should be valid TOML", () => {
    // If it parses without error, it's valid
    expect(() => {
      const { parse } = require("smol-toml");
      parse(DEFAULT_TOML_TEMPLATE);
    }).not.toThrow();
  });

  it("should contain all major config sections", () => {
    expect(DEFAULT_TOML_TEMPLATE).toContain("[llm]");
    expect(DEFAULT_TOML_TEMPLATE).toContain("[tools]");
    expect(DEFAULT_TOML_TEMPLATE).toContain("[paths]");
    expect(DEFAULT_TOML_TEMPLATE).toContain("[logging]");
  });

  it("should contain helpful comments", () => {
    expect(DEFAULT_TOML_TEMPLATE).toContain("#");
  });
});

import { expandPath } from "../src/config";
import { homedir } from "os";

describe("expandPath", () => {
  it("should expand ~ to home directory", () => {
    const result = expandPath("~/.marvis/data");
    expect(result).toBe(`${homedir()}/.marvis/data`);
  });

  it("should expand ~ at the start only", () => {
    const result = expandPath("~/some/path~with~tildes");
    expect(result).toBe(`${homedir()}/some/path~with~tildes`);
  });

  it("should not modify paths without ~", () => {
    const result = expandPath("/absolute/path");
    expect(result).toBe("/absolute/path");
  });

  it("should handle ~ alone", () => {
    const result = expandPath("~");
    expect(result).toBe(homedir());
  });

  it("should not expand ~ in the middle of a path", () => {
    const result = expandPath("/path/to/~user/data");
    expect(result).toBe("/path/to/~user/data");
  });
});

describe("path expansion in loadConfig", () => {
  const testDir = join(tmpdir(), "marvis-path-test-" + Date.now());
  const configPath = join(testDir, "config.toml");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.MARVIS_CONFIG = configPath;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    delete process.env.MARVIS_CONFIG;
  });

  it("should expand ~ in paths from TOML config", () => {
    writeFileSync(
      configPath,
      `
[paths]
data_dir = "~/.marvis/custom-data"
log_dir = "~/.marvis/custom-logs"
`,
    );
    const config = loadConfig();
    expect(config.paths.dataDir).toBe(`${homedir()}/.marvis/custom-data`);
    expect(config.paths.logDir).toBe(`${homedir()}/.marvis/custom-logs`);
  });

  it("should expand ~ in logging.file from TOML config", () => {
    writeFileSync(
      configPath,
      `
[logging]
file = "~/.marvis/logs/marvis.log"
`,
    );
    const config = loadConfig();
    expect(config.logging.file).toBe(`${homedir()}/.marvis/logs/marvis.log`);
  });
});

import { ConfigError } from "../src/config-error";

describe("TypeBox validation", () => {
  const testDir = join(tmpdir(), "marvis-validation-test-" + Date.now());
  const configPath = join(testDir, "config.toml");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.MARVIS_CONFIG = configPath;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    delete process.env.MARVIS_CONFIG;
  });

  it("should throw ConfigError for invalid provider in TOML", () => {
    writeFileSync(
      configPath,
      `
[llm]
provider = "invalid-provider"
`,
    );
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("should throw ConfigError for invalid log level in TOML", () => {
    writeFileSync(
      configPath,
      `
[logging]
level = "verbose"
`,
    );
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("should throw ConfigError for invalid danger threshold in TOML", () => {
    writeFileSync(
      configPath,
      `
[tools]
danger_threshold = "high"
`,
    );
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("should include path in ConfigError", () => {
    writeFileSync(
      configPath,
      `
[llm]
provider = "invalid"
`,
    );
    try {
      loadConfig();
      expect.fail("Expected ConfigError");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).path).toContain("/llm/provider");
    }
  });

  it("should include source in ConfigError", () => {
    writeFileSync(
      configPath,
      `
[llm]
provider = "invalid"
`,
    );
    try {
      loadConfig();
      expect.fail("Expected ConfigError");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).source).toContain("TOML");
    }
  });
});

describe("CLI config overrides", () => {
  const testDir = join(tmpdir(), "marvis-cli-test-" + Date.now());
  const configPath = join(testDir, "config.toml");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.MARVIS_CONFIG = configPath;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    delete process.env.MARVIS_CONFIG;
    delete process.env.MARVIS_PROVIDER;
    delete process.env.MARVIS_MODEL;
    delete process.env.MARVIS_LOG_LEVEL;
  });

  it("should apply CLI provider over env var", () => {
    writeFileSync(configPath, "");
    process.env.MARVIS_PROVIDER = "openai";
    const config = loadConfig({ provider: "google" });
    expect(config.llm.provider).toBe("google");
  });

  it("should apply CLI model over env var", () => {
    writeFileSync(configPath, "");
    process.env.MARVIS_MODEL = "gpt-4o";
    const config = loadConfig({ model: "gemini-pro" });
    expect(config.llm.model).toBe("gemini-pro");
  });

  it("should apply CLI logLevel over env var", () => {
    writeFileSync(configPath, "");
    process.env.MARVIS_LOG_LEVEL = "info";
    const config = loadConfig({ logLevel: "debug" });
    expect(config.logging.level).toBe("debug");
  });

  it("should use CLI config path over env var", () => {
    const customDir = join(tmpdir(), "marvis-cli-custom-" + Date.now());
    const customPath = join(customDir, "custom.toml");
    mkdirSync(customDir, { recursive: true });
    writeFileSync(
      customPath,
      `
[llm]
provider = "google"
`,
    );
    const config = loadConfig({ config: customPath });
    expect(config.llm.provider).toBe("google");
    rmSync(customDir, { recursive: true });
  });

  it("should throw error for invalid CLI provider", () => {
    writeFileSync(configPath, "");
    expect(() => loadConfig({ provider: "invalid" })).toThrow(
      /Invalid provider/,
    );
  });

  it("should throw error for invalid CLI log level", () => {
    writeFileSync(configPath, "");
    expect(() => loadConfig({ logLevel: "verbose" })).toThrow(
      /Invalid log level/,
    );
  });
});

describe("Full Config Integration", () => {
  it("should follow precedence: CLI > env > TOML > defaults", async () => {
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { mkdirSync, writeFileSync, rmSync } = await import("fs");

    const testDir = join(tmpdir(), "marvis-integration-" + Date.now());
    const configPath = join(testDir, "config.toml");
    mkdirSync(testDir, { recursive: true });

    writeFileSync(
      configPath,
      `
[llm]
provider = "openai"
model = "toml-model"

[logging]
level = "warn"
`,
    );

    process.env.MARVIS_CONFIG = configPath;
    process.env.MARVIS_MODEL = "env-model";

    const config = loadConfig({ logLevel: "debug" });

    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("env-model");
    expect(config.logging.level).toBe("debug");
    expect(config.tools.confirmDangerous).toBe(true);

    delete process.env.MARVIS_CONFIG;
    delete process.env.MARVIS_MODEL;
    rmSync(testDir, { recursive: true });
  });
});

import { ensureDirectoriesExist } from "../src/config";

describe("ensureDirectoriesExist", () => {
  const testDir = join(tmpdir(), "marvis-dirs-test-" + Date.now());

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it("should create dataDir when it does not exist", () => {
    const dataDir = join(testDir, "data");
    const logDir = join(testDir, "logs");
    ensureDirectoriesExist({ dataDir, logDir });
    expect(existsSync(dataDir)).toBe(true);
  });

  it("should create logDir when it does not exist", () => {
    const dataDir = join(testDir, "data");
    const logDir = join(testDir, "logs");
    ensureDirectoriesExist({ dataDir, logDir });
    expect(existsSync(logDir)).toBe(true);
  });

  it("should create nested directories recursively", () => {
    const dataDir = join(testDir, "deep", "nested", "data");
    const logDir = join(testDir, "deep", "nested", "logs");
    ensureDirectoriesExist({ dataDir, logDir });
    expect(existsSync(dataDir)).toBe(true);
    expect(existsSync(logDir)).toBe(true);
  });

  it("should not throw if directories already exist", () => {
    const dataDir = join(testDir, "data");
    const logDir = join(testDir, "logs");
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(logDir, { recursive: true });
    expect(() => ensureDirectoriesExist({ dataDir, logDir })).not.toThrow();
  });
});
