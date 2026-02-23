import type { PluginManifest, PluginHealthCheck, PluginMode } from "../types/index.js";
import { createLogger, type Logger } from "../daemon/logger.js";

// Re-export for convenience
export type { PluginManifest };

export type DangerLevel = "safe" | "moderate" | "dangerous";

export interface AgentTool {
  name: string;
  description: string;
  parameters: unknown;
  dangerLevel?: DangerLevel;
  execute: (params: unknown) => Promise<unknown>;
}

export interface Agent {
  run(message: string): Promise<string>;
}

export interface Plugin {
  manifest: PluginManifest;
  mode: PluginMode;

  initialize(config: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;

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

  protected config: Record<string, unknown> = {};
  protected logger!: Logger;
  private _agent?: Agent;

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = config;
    this.logger = createLogger(this.manifest.id);
    await this.onInitialize();
  }

  async shutdown(): Promise<void> {
    await this.onShutdown();
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
