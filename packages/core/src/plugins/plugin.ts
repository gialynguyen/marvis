import type {
  AgentToolResult,
  AgentTool as PiAgentTool,
} from "@mariozechner/pi-agent-core";
import type { PluginManifest, PluginHealthCheck, PluginMode } from "../types";
import { createLogger, type Logger } from "../daemon/logger";
import type { TObject, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// Re-export for convenience
export type { PluginManifest };

export type DangerLevel = "safe" | "moderate" | "dangerous";

export interface AgentTool<TParams = any, TResult = any> {
  name: string;
  description: string;
  parameters: TSchema;
  dangerLevel?: DangerLevel;
  execute: (params: TParams) => Promise<AgentToolResult<TResult>>;
}

export interface Agent {
  run(message: string): Promise<string>;
}

/**
 * Describes a plugin's configuration shape, defaults, and documentation.
 * Plugins that declare a configDescriptor get automatic validation and
 * default-merging during initialization.
 */
export interface PluginConfigDescriptor<T = Record<string, unknown>> {
  /** TypeBox schema describing this plugin's config shape */
  schema: TObject;
  /** Default values (must validate against schema) */
  defaults: T;
  /** Human-readable description of each field, used for TOML comments */
  descriptions?: Record<string, string>;
}

export interface Plugin {
  manifest: PluginManifest;
  mode: PluginMode;

  /** Optional: declare plugin-owned configuration schema + defaults */
  configDescriptor?: PluginConfigDescriptor;

  initialize(config: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;

  /**
   * Called when this plugin's config section changes at runtime (hot-reload).
   * The default BasePlugin implementation re-validates and updates this.config.
   * Override to perform additional work (e.g., reconnect to a different service).
   */
  onConfigChange?(newConfig: Record<string, unknown>): Promise<void>;

  getTools(): AgentTool[];
  getAgent?(): Agent | undefined;
  getSystemPromptFragment(): string;
  healthCheck(): Promise<PluginHealthCheck>;

  promoteToAgent(agent: Agent): void;
  demoteToTools(): void;
}

export abstract class BasePlugin implements Plugin {
  abstract manifest: PluginManifest;
  mode: PluginMode = "tools";
  configDescriptor?: PluginConfigDescriptor;

  protected config: Record<string, unknown> = {};
  protected logger!: Logger;
  private _agent?: Agent;

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.logger = createLogger(this.manifest.id);

    // If plugin declares a config descriptor, validate + merge defaults
    if (this.configDescriptor) {
      const merged = { ...this.configDescriptor.defaults, ...config };
      if (!Value.Check(this.configDescriptor.schema, merged)) {
        const errors = [...Value.Errors(this.configDescriptor.schema, merged)];
        throw new Error(
          `Invalid config for plugin "${this.manifest.id}": ${errors[0]?.message} at ${errors[0]?.path}`,
        );
      }
      this.config = merged;
    } else {
      this.config = config;
    }

    await this.onInitialize();
  }

  async shutdown(): Promise<void> {
    await this.onShutdown();
  }

  /**
   * Default hot-reload handler: re-validates the new config against the
   * plugin's configDescriptor (if any) and updates `this.config`.
   * Override in subclasses to perform additional work (e.g., reconnect).
   */
  async onConfigChange(newConfig: Record<string, unknown>): Promise<void> {
    if (this.configDescriptor) {
      const merged = { ...this.configDescriptor.defaults, ...newConfig };
      if (!Value.Check(this.configDescriptor.schema, merged)) {
        const errors = [...Value.Errors(this.configDescriptor.schema, merged)];
        throw new Error(
          `Invalid config for plugin "${this.manifest.id}": ${errors[0]?.message} at ${errors[0]?.path}`,
        );
      }
      this.config = merged;
    } else {
      this.config = newConfig;
    }
  }

  protected abstract onInitialize(): Promise<void>;
  protected abstract onShutdown(): Promise<void>;
  abstract getTools(): AgentTool[];
  abstract getSystemPromptFragment(): string;

  getAgent(): Agent | undefined {
    return this._agent;
  }

  async healthCheck(): Promise<PluginHealthCheck> {
    return { healthy: true };
  }

  promoteToAgent(agent: Agent): void {
    this.mode = "agent";
    this._agent = agent;
  }

  demoteToTools(): void {
    this.mode = "tools";
    this._agent = undefined;
  }
}
