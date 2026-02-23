// src/types/index.ts
import { Type, Static } from "@sinclair/typebox";

// ============= Plugin Types =============

export const PluginManifestSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  version: Type.String(),
  description: Type.String(),
  author: Type.Optional(Type.String()),
  dependencies: Type.Optional(Type.Array(Type.String())),
  capabilities: Type.Array(Type.String()),
});

export type PluginManifest = Static<typeof PluginManifestSchema>;

export type PluginMode = "tools" | "agent";

export interface PluginHealthCheck {
  healthy: boolean;
  message?: string;
}

// ============= IPC Types =============

export type IPCRequestType =
  | "prompt"
  | "abort"
  | "status"
  | "history"
  | "new_conversation"
  | "plugins"
  | "plugin_promote"
  | "plugin_demote"
  | "shutdown";

export interface IPCRequest {
  id: string;
  type: IPCRequestType;
  data?: Record<string, unknown>;
}

export interface IPCResponse {
  id?: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface IPCStreamChunk {
  id: string;
  chunk?: string;
  done: boolean;
}

// ============= Memory Types =============

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: unknown[];
  toolCallId?: string;
  tokensEstimated: number;
  createdAt: number;
}

export interface Memory {
  id: string;
  type: "fact" | "preference" | "entity" | "summary";
  content: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  importance: number;
  accessCount: number;
  lastAccessed?: number;
  createdAt: number;
  expiresAt?: number;
}

// ============= Config Types =============

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
}

export interface DaemonConfig {
  socketPath: string;
  pidFile: string;
  logFile: string;
  dbPath: string;
  marvisConfig: MarvisConfig;
}

// ============= Status Types =============

export interface DaemonStatus {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  pid: number;
  conversationId: string | null;
  pluginCount: number;
  activeAgents: string[];
}
