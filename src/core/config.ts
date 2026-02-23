import { type MarvisConfig } from "../types/index.js";

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
};

const VALID_PROVIDERS = ["openai", "anthropic", "google"] as const;
const VALID_THRESHOLDS = ["moderate", "dangerous"] as const;

export function loadConfig(): MarvisConfig {
  const config = structuredClone(DEFAULT_CONFIG);

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

  return config;
}
