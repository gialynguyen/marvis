# Marvis Design Document

**Date**: 2026-02-22  
**Status**: Approved  
**Author**: AI-assisted design session

---

## Overview

Marvis is a personal AI assistant (inspired by Jarvis from Iron Man) running as a daemon process on macOS. It's a multi-agent system with a leader agent (Marvis) orchestrating sub-agents for various capabilities.

### Core Principles

- **Pi Framework Foundation**: Built on `@mariozechner/pi-agent-core` and `@mariozechner/pi-ai`
- **Hybrid Architecture**: Start with tools, design so they can be promoted to full agents later
- **Interface Priority**: CLI first → API second → Voice third (incremental build)
- **LLM Strategy**: Local-first (Ollama) with multi-model cloud routing for complex tasks
- **Persistence**: Full persistent memory across restarts (SQLite)

### V1 Scope

Minimal viable system:
- Daemon process with lifecycle management
- CLI interface with REPL mode
- 3 initial plugins: shell, files, web
- SQLite-backed conversation persistence
- Local-first LLM with cloud fallback

---

## Section 1: Project Structure & Tech Stack

### Directory Structure

```
marvis/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Library exports
│   ├── daemon/
│   │   ├── daemon.ts               # MarvisDaemon class
│   │   ├── ipc-server.ts           # Unix socket IPC
│   │   ├── lifecycle.ts            # Start/stop/restart logic
│   │   └── logger.ts               # Structured logging
│   ├── core/
│   │   ├── marvis.ts               # Main Marvis agent wrapper
│   │   ├── model-router.ts         # Local/cloud model routing
│   │   ├── config.ts               # Configuration management
│   │   └── memory/
│   │       ├── store.ts            # SQLite persistence layer
│   │       ├── context.ts          # Context window management
│   │       └── types.ts            # Memory-related types
│   ├── plugins/
│   │   ├── plugin.ts               # Plugin interface & BasePlugin
│   │   ├── manager.ts              # PluginManager
│   │   ├── registry.ts             # Plugin discovery & loading
│   │   ├── shell/
│   │   │   ├── index.ts
│   │   │   └── tools.ts
│   │   ├── files/
│   │   │   ├── index.ts
│   │   │   └── tools.ts
│   │   └── web/
│   │       ├── index.ts
│   │       └── tools.ts
│   ├── cli/
│   │   ├── cli.ts                  # CLI entry point
│   │   ├── repl.ts                 # Interactive REPL
│   │   └── commands.ts             # Slash commands
│   └── types/
│       └── index.ts                # Shared type definitions
├── bin/
│   ├── marvis.ts                   # CLI binary entry
│   └── marvis-daemon.ts            # Daemon binary entry
├── data/                           # Runtime data (gitignored)
│   ├── marvis.db                   # SQLite database
│   ├── marvis.sock                 # Unix socket
│   └── marvis.pid                  # PID file
└── docs/
    └── plans/
        └── 2026-02-22-marvis-design.md
```

### Tech Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Node.js 20+ | Pi framework requirement, native ESM |
| Language | TypeScript 5.x | Type safety, Pi framework compatibility |
| LLM API | `@mariozechner/pi-ai` | Unified multi-provider API |
| Agent Core | `@mariozechner/pi-agent-core` | Stateful agent with tool execution |
| Database | better-sqlite3 | Synchronous, embedded, zero-config |
| CLI | Commander.js | Standard Node CLI framework |
| IPC | Unix domain sockets | Fast, secure, macOS-native |
| Process | Native Node (no PM2) | Simpler, fewer dependencies |

### Package Dependencies

```json
{
  "dependencies": {
    "@mariozechner/pi-agent-core": "latest",
    "@mariozechner/pi-ai": "latest",
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "tsx": "^4.0.0"
  }
}
```

---

## Section 2: Plugin System

### Plugin Interface

```typescript
import { AgentTool, Agent } from "@mariozechner/pi-agent-core";

interface PluginManifest {
  id: string;           // Unique identifier, e.g., "shell"
  name: string;         // Display name, e.g., "Shell Commands"
  version: string;      // SemVer
  description: string;
  author?: string;
  
  // Dependencies on other plugins (optional)
  dependencies?: string[];
  
  // Configuration schema (TypeBox)
  configSchema?: TSchema;
  
  // Capabilities this plugin provides
  capabilities: string[];  // e.g., ["execute_shell", "read_env"]
}

interface Plugin {
  // Static metadata
  manifest: PluginManifest;
  
  // Current operating mode
  mode: "tools" | "agent";
  
  // Lifecycle
  initialize(config: Record<string, any>): Promise<void>;
  shutdown(): Promise<void>;
  
  // Tool mode: returns tools for Marvis to use directly
  getTools(): AgentTool[];
  
  // Agent mode: returns a sub-agent that Marvis delegates to
  getAgent?(): Agent;
  
  // System prompt fragment describing this plugin's capabilities
  getSystemPromptFragment(): string;
  
  // Health check
  healthCheck(): Promise<{ healthy: boolean; message?: string }>;
}
```

### BasePlugin Abstract Class

```typescript
abstract class BasePlugin implements Plugin {
  abstract manifest: PluginManifest;
  mode: "tools" | "agent" = "tools";
  
  protected config: Record<string, any> = {};
  protected logger: Logger;
  
  constructor() {
    this.logger = createLogger(this.manifest.id);
  }
  
  async initialize(config: Record<string, any>): Promise<void> {
    this.config = config;
    await this.onInitialize();
  }
  
  async shutdown(): Promise<void> {
    await this.onShutdown();
  }
  
  // Subclasses implement these
  protected abstract onInitialize(): Promise<void>;
  protected abstract onShutdown(): Promise<void>;
  abstract getTools(): AgentTool[];
  abstract getSystemPromptFragment(): string;
  
  // Default implementations
  getAgent(): Agent | undefined {
    return undefined;  // Override in agent mode
  }
  
  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    return { healthy: true };
  }
  
  // Mode switching
  promoteToAgent(agent: Agent): void {
    this.mode = "agent";
    this._agent = agent;
  }
  
  demoteToTools(): void {
    this.mode = "tools";
    this._agent = undefined;
  }
}
```

### PluginManager

```typescript
class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private loadOrder: string[] = [];
  
  // Plugin lifecycle
  async loadPlugin(plugin: Plugin): Promise<void> {
    // Validate manifest
    // Check dependencies
    // Initialize with config
    // Register in map
  }
  
  async unloadPlugin(id: string): Promise<void> {
    // Shutdown gracefully
    // Remove from map
  }
  
  // Tool/Agent collection for Marvis
  getAllTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.mode === "tools") {
        tools.push(...plugin.getTools());
      }
    }
    return tools;
  }
  
  getActiveAgents(): Map<string, Agent> {
    const agents = new Map<string, Agent>();
    for (const [id, plugin] of this.plugins) {
      if (plugin.mode === "agent") {
        const agent = plugin.getAgent();
        if (agent) agents.set(id, agent);
      }
    }
    return agents;
  }
  
  // System prompt assembly
  getSystemPromptFragments(): string {
    return Array.from(this.plugins.values())
      .map(p => p.getSystemPromptFragment())
      .join("\n\n");
  }
  
  // Runtime mode switching
  async promotePlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin ${id} not found`);
    
    // Create agent for this plugin
    const agent = await this.createAgentForPlugin(plugin);
    plugin.promoteToAgent(agent);
  }
  
  async demotePlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin ${id} not found`);
    plugin.demoteToTools();
  }
}
```

### Example: Shell Plugin

```typescript
// src/plugins/shell/index.ts
import { Type } from "@sinclair/typebox";
import { BasePlugin, PluginManifest } from "../plugin";
import { AgentTool } from "@mariozechner/pi-agent-core";

export class ShellPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "shell",
    name: "Shell Commands",
    version: "1.0.0",
    description: "Execute shell commands and manage processes",
    capabilities: ["execute_shell", "read_env", "manage_processes"],
    configSchema: Type.Object({
      allowedCommands: Type.Optional(Type.Array(Type.String())),
      blockedCommands: Type.Optional(Type.Array(Type.String())),
      timeout: Type.Optional(Type.Number({ default: 30000 })),
    }),
  };

  protected async onInitialize(): Promise<void> {
    // Validate shell availability
    // Set up command filtering
  }

  protected async onShutdown(): Promise<void> {
    // Kill any running processes
  }

  getTools(): AgentTool[] {
    return [
      {
        name: "execute_command",
        description: "Execute a shell command and return the output",
        parameters: Type.Object({
          command: Type.String({ description: "The command to execute" }),
          cwd: Type.Optional(Type.String({ description: "Working directory" })),
          timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
        }),
        execute: async (params) => {
          // Implementation with safety checks
          const { command, cwd, timeout } = params;
          // ... execute and return result
        },
      },
      {
        name: "get_env",
        description: "Get environment variable value",
        parameters: Type.Object({
          name: Type.String({ description: "Environment variable name" }),
        }),
        execute: async ({ name }) => {
          return process.env[name] ?? null;
        },
      },
    ];
  }

  getSystemPromptFragment(): string {
    return `## Shell Commands
You can execute shell commands on the user's macOS system.
- Use execute_command for running terminal commands
- Use get_env to read environment variables
- Be cautious with destructive commands (rm, mv, etc.)
- Always confirm before running commands that modify the system`;
  }
}
```

---

## Section 3: Core Agent & Model Router

### Marvis Class

```typescript
// src/core/marvis.ts
import { Agent, AgentTool } from "@mariozechner/pi-agent-core";
import { ChatMessage } from "@mariozechner/pi-ai";
import { PluginManager } from "../plugins/manager";
import { ModelRouter } from "./model-router";
import { MemoryStore } from "./memory/store";
import { ContextManager } from "./memory/context";

interface MarvisConfig {
  systemPrompt?: string;
  maxContextTokens?: number;
  localModel?: string;
  cloudModel?: string;
}

class Marvis {
  private agent: Agent;
  private pluginManager: PluginManager;
  private modelRouter: ModelRouter;
  private memoryStore: MemoryStore;
  private contextManager: ContextManager;
  private currentConversationId: string | null = null;

  constructor(config: MarvisConfig) {
    this.pluginManager = new PluginManager();
    this.modelRouter = new ModelRouter(config);
    this.memoryStore = new MemoryStore();
    this.contextManager = new ContextManager(config.maxContextTokens ?? 8192);
  }

  async initialize(): Promise<void> {
    // Load built-in plugins
    await this.loadBuiltinPlugins();
    
    // Build the agent
    this.agent = this.buildAgent();
    
    // Restore last conversation or create new
    this.currentConversationId = await this.memoryStore.getLastConversationId();
    if (!this.currentConversationId) {
      this.currentConversationId = await this.memoryStore.createConversation();
    }
  }

  private buildAgent(): Agent {
    const tools = this.pluginManager.getAllTools();
    const delegationTools = this.buildDelegationTools();
    const systemPrompt = this.buildSystemPrompt();
    
    return new Agent({
      tools: [...tools, ...delegationTools],
      systemPrompt,
      api: this.modelRouter.getApi(),
      model: this.modelRouter.getCurrentModel(),
    });
  }

  private buildSystemPrompt(): string {
    const pluginPrompts = this.pluginManager.getSystemPromptFragments();
    const activeAgents = this.pluginManager.getActiveAgents();
    
    let prompt = `You are Marvis, a personal AI assistant running on the user's macOS computer.
You have access to various tools and capabilities to help the user.

## Your Capabilities
${pluginPrompts}
`;

    if (activeAgents.size > 0) {
      prompt += `\n## Specialized Agents Available
You can delegate complex tasks to specialized agents:
${Array.from(activeAgents.keys()).map(id => `- ${id}`).join("\n")}

Use the delegate_to_agent tool when a task requires specialized handling.
`;
    }

    return prompt;
  }

  private buildDelegationTools(): AgentTool[] {
    const activeAgents = this.pluginManager.getActiveAgents();
    if (activeAgents.size === 0) return [];

    return [{
      name: "delegate_to_agent",
      description: "Delegate a task to a specialized agent",
      parameters: Type.Object({
        agent: Type.String({ 
          description: "The agent to delegate to",
          enum: Array.from(activeAgents.keys()),
        }),
        task: Type.String({ description: "The task description" }),
        context: Type.Optional(Type.String({ 
          description: "Additional context for the agent" 
        })),
      }),
      execute: async ({ agent, task, context }) => {
        const targetAgent = activeAgents.get(agent);
        if (!targetAgent) throw new Error(`Agent ${agent} not found`);
        
        const response = await targetAgent.run(
          context ? `${task}\n\nContext: ${context}` : task
        );
        return response;
      },
    }];
  }

  // Main interaction method
  async chat(message: string): Promise<AsyncIterable<string>> {
    // Store user message
    await this.memoryStore.addMessage(this.currentConversationId!, {
      role: "user",
      content: message,
    });

    // Build context with history
    const history = await this.contextManager.buildContext(
      this.currentConversationId!,
      this.memoryStore
    );

    // Route to appropriate model
    const model = await this.modelRouter.selectModel(message, history);
    
    // Run agent
    const response = this.agent.runStreaming(message, {
      model,
      context: history,
    });

    // Collect and store response
    let fullResponse = "";
    const self = this;
    
    return (async function* () {
      for await (const chunk of response) {
        fullResponse += chunk;
        yield chunk;
      }
      
      // Store assistant response
      await self.memoryStore.addMessage(self.currentConversationId!, {
        role: "assistant",
        content: fullResponse,
      });
    })();
  }

  // Conversation management
  async newConversation(): Promise<string> {
    this.currentConversationId = await this.memoryStore.createConversation();
    return this.currentConversationId;
  }

  async switchConversation(id: string): Promise<void> {
    const exists = await this.memoryStore.conversationExists(id);
    if (!exists) throw new Error(`Conversation ${id} not found`);
    this.currentConversationId = id;
  }

  // Plugin management
  async promotePlugin(id: string): Promise<void> {
    await this.pluginManager.promotePlugin(id);
    this.agent = this.buildAgent(); // Rebuild with delegation tools
  }

  async demotePlugin(id: string): Promise<void> {
    await this.pluginManager.demotePlugin(id);
    this.agent = this.buildAgent();
  }

  // Shutdown
  async shutdown(): Promise<void> {
    await this.pluginManager.shutdownAll();
    await this.memoryStore.close();
  }
}
```

### ModelRouter

```typescript
// src/core/model-router.ts
import { Api, createApi } from "@mariozechner/pi-ai";
import { ChatMessage } from "@mariozechner/pi-ai";

interface ModelRouterConfig {
  localModel?: string;      // Default: "ollama/llama3.2"
  cloudModel?: string;      // Default: "anthropic/claude-3-5-sonnet"
  complexityThreshold?: number;  // Token count threshold
  alwaysLocal?: boolean;    // Force local-only mode
}

interface RoutingDecision {
  model: string;
  reason: string;
}

class ModelRouter {
  private localApi: Api;
  private cloudApi: Api | null;
  private config: ModelRouterConfig;

  constructor(config: ModelRouterConfig = {}) {
    this.config = {
      localModel: config.localModel ?? "ollama/llama3.2",
      cloudModel: config.cloudModel ?? "anthropic/claude-3-5-sonnet",
      complexityThreshold: config.complexityThreshold ?? 2000,
      alwaysLocal: config.alwaysLocal ?? false,
    };

    // Initialize APIs
    this.localApi = createApi({ provider: "ollama" });
    this.cloudApi = this.config.alwaysLocal 
      ? null 
      : createApi({ provider: "anthropic" });
  }

  async selectModel(
    message: string, 
    history: ChatMessage[]
  ): Promise<string> {
    if (this.config.alwaysLocal) {
      return this.config.localModel!;
    }

    const decision = this.analyzeComplexity(message, history);
    return decision.model;
  }

  private analyzeComplexity(
    message: string, 
    history: ChatMessage[]
  ): RoutingDecision {
    // Heuristics for complexity detection
    const indicators = {
      codeGeneration: /write|create|implement|build|code/i.test(message),
      analysis: /analyze|explain|why|how does/i.test(message),
      multiStep: /and then|after that|first.*then/i.test(message),
      longContext: this.estimateTokens(history) > this.config.complexityThreshold!,
    };

    const complexityScore = Object.values(indicators).filter(Boolean).length;

    if (complexityScore >= 2) {
      return {
        model: this.config.cloudModel!,
        reason: `High complexity (score: ${complexityScore})`,
      };
    }

    // Check if Ollama is available
    if (!this.isOllamaAvailable()) {
      return {
        model: this.config.cloudModel!,
        reason: "Ollama not available, falling back to cloud",
      };
    }

    return {
      model: this.config.localModel!,
      reason: "Simple task, using local model",
    };
  }

  private estimateTokens(messages: ChatMessage[]): number {
    // Rough estimation: ~4 chars per token
    return messages.reduce((sum, m) => {
      const content = typeof m.content === "string" 
        ? m.content 
        : JSON.stringify(m.content);
      return sum + Math.ceil(content.length / 4);
    }, 0);
  }

  private isOllamaAvailable(): boolean {
    // TODO: Implement actual health check
    return true;
  }

  getApi(): Api {
    return this.localApi; // Agent uses local by default
  }

  getCurrentModel(): string {
    return this.config.localModel!;
  }
}
```

---

## Section 4: Memory & Persistence

### SQLite Schema

```sql
-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT  -- JSON blob for extensibility
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,  -- 'user', 'assistant', 'system', 'tool'
  content TEXT NOT NULL,
  tool_calls TEXT,  -- JSON array of tool calls (if assistant)
  tool_call_id TEXT,  -- Reference to tool call (if tool response)
  tokens_estimated INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation 
  ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated 
  ON conversations(updated_at DESC);

-- Long-term memory (facts, preferences, learned info)
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,  -- 'fact', 'preference', 'entity', 'summary'
  content TEXT NOT NULL,
  source_conversation_id TEXT,
  source_message_id TEXT,
  importance REAL DEFAULT 0.5,  -- 0-1 scale
  access_count INTEGER DEFAULT 0,
  last_accessed INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,  -- Optional TTL
  embedding BLOB,  -- For future semantic search
  FOREIGN KEY (source_conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
```

### MemoryStore

```typescript
// src/core/memory/store.ts
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { ChatMessage } from "@mariozechner/pi-ai";

interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: any[];
  toolCallId?: string;
  tokensEstimated: number;
  createdAt: number;
}

interface Conversation {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
}

class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string = "data/marvis.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");  // Better concurrent access
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        tokens_estimated INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation 
        ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated 
        ON conversations(updated_at DESC);

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        source_conversation_id TEXT,
        source_message_id TEXT,
        importance REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        embedding BLOB,
        FOREIGN KEY (source_conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
    `);
  }

  // Conversation methods
  async createConversation(title?: string): Promise<string> {
    const id = randomUUID();
    const now = Date.now();
    
    this.db.prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, title ?? null, now, now);
    
    return id;
  }

  async getLastConversationId(): Promise<string | null> {
    const row = this.db.prepare(`
      SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1
    `).get() as { id: string } | undefined;
    
    return row?.id ?? null;
  }

  async conversationExists(id: string): Promise<boolean> {
    const row = this.db.prepare(`
      SELECT 1 FROM conversations WHERE id = ?
    `).get(id);
    
    return !!row;
  }

  async listConversations(limit = 50): Promise<Conversation[]> {
    return this.db.prepare(`
      SELECT id, title, created_at as createdAt, updated_at as updatedAt, metadata
      FROM conversations
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as Conversation[];
  }

  // Message methods
  async addMessage(
    conversationId: string,
    message: ChatMessage & { toolCalls?: any[]; toolCallId?: string }
  ): Promise<string> {
    const id = randomUUID();
    const now = Date.now();
    const content = typeof message.content === "string" 
      ? message.content 
      : JSON.stringify(message.content);
    const tokensEstimated = Math.ceil(content.length / 4);

    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, tokens_estimated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      conversationId,
      message.role,
      content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolCallId ?? null,
      tokensEstimated,
      now
    );

    // Update conversation timestamp
    this.db.prepare(`
      UPDATE conversations SET updated_at = ? WHERE id = ?
    `).run(now, conversationId);

    return id;
  }

  async getMessages(
    conversationId: string,
    limit?: number
  ): Promise<StoredMessage[]> {
    const query = limit
      ? `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?`
      : `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`;
    
    const rows = limit
      ? this.db.prepare(query).all(conversationId, limit)
      : this.db.prepare(query).all(conversationId);

    return (rows as any[]).map(row => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolCallId: row.tool_call_id,
      tokensEstimated: row.tokens_estimated,
      createdAt: row.created_at,
    }));
  }

  async getMessageCount(conversationId: string): Promise<number> {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?
    `).get(conversationId) as { count: number };
    
    return row.count;
  }

  async getTotalTokens(conversationId: string): Promise<number> {
    const row = this.db.prepare(`
      SELECT SUM(tokens_estimated) as total FROM messages WHERE conversation_id = ?
    `).get(conversationId) as { total: number | null };
    
    return row.total ?? 0;
  }

  // Long-term memory methods
  async addMemory(memory: {
    type: string;
    content: string;
    sourceConversationId?: string;
    sourceMessageId?: string;
    importance?: number;
    expiresAt?: number;
  }): Promise<string> {
    const id = randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO memories (id, type, content, source_conversation_id, source_message_id, importance, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      memory.type,
      memory.content,
      memory.sourceConversationId ?? null,
      memory.sourceMessageId ?? null,
      memory.importance ?? 0.5,
      now,
      memory.expiresAt ?? null
    );

    return id;
  }

  async getRelevantMemories(
    types?: string[],
    limit = 10
  ): Promise<any[]> {
    const whereClause = types?.length
      ? `WHERE type IN (${types.map(() => "?").join(",")})`
      : "";
    
    const query = `
      SELECT * FROM memories
      ${whereClause}
      ORDER BY importance DESC, last_accessed DESC
      LIMIT ?
    `;

    const params = types?.length ? [...types, limit] : [limit];
    return this.db.prepare(query).all(...params);
  }

  // Cleanup
  close(): void {
    this.db.close();
  }
}
```

### ContextManager

```typescript
// src/core/memory/context.ts
import { ChatMessage } from "@mariozechner/pi-ai";
import { MemoryStore, StoredMessage } from "./store";

class ContextManager {
  private maxTokens: number;
  private reservedTokens: number;  // For system prompt and response

  constructor(maxTokens: number = 8192, reservedTokens: number = 2048) {
    this.maxTokens = maxTokens;
    this.reservedTokens = reservedTokens;
  }

  async buildContext(
    conversationId: string,
    store: MemoryStore
  ): Promise<ChatMessage[]> {
    const availableTokens = this.maxTokens - this.reservedTokens;
    const messages = await store.getMessages(conversationId);
    
    // Strategy: Keep most recent messages, summarize older ones
    return this.selectMessages(messages, availableTokens);
  }

  private selectMessages(
    messages: StoredMessage[],
    availableTokens: number
  ): ChatMessage[] {
    const selected: ChatMessage[] = [];
    let usedTokens = 0;

    // Work backwards from most recent
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      
      if (usedTokens + msg.tokensEstimated > availableTokens) {
        // TODO: Could summarize remaining messages instead of dropping
        break;
      }

      selected.unshift({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
      });
      usedTokens += msg.tokensEstimated;
    }

    return selected;
  }

  // Future: Implement summarization for long conversations
  private async summarizeMessages(
    messages: StoredMessage[]
  ): Promise<string> {
    // Would use LLM to create summary
    throw new Error("Not implemented");
  }
}
```

---

## Section 5: Daemon & IPC

### MarvisDaemon

```typescript
// src/daemon/daemon.ts
import { Marvis } from "../core/marvis";
import { IPCServer } from "./ipc-server";
import { Logger, createLogger } from "./logger";
import { writeFileSync, unlinkSync, existsSync } from "fs";

interface DaemonConfig {
  socketPath: string;
  pidFile: string;
  logFile: string;
  marvisConfig: MarvisConfig;
}

class MarvisDaemon {
  private marvis: Marvis;
  private ipcServer: IPCServer;
  private logger: Logger;
  private config: DaemonConfig;
  private isShuttingDown = false;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.logger = createLogger("daemon", config.logFile);
  }

  async start(): Promise<void> {
    // Check if already running
    if (this.isAlreadyRunning()) {
      throw new Error("Marvis daemon is already running");
    }

    this.logger.info("Starting Marvis daemon...");

    // Write PID file
    this.writePidFile();

    // Initialize Marvis core
    this.marvis = new Marvis(this.config.marvisConfig);
    await this.marvis.initialize();
    this.logger.info("Marvis core initialized");

    // Start IPC server
    this.ipcServer = new IPCServer(
      this.config.socketPath,
      this.handleRequest.bind(this)
    );
    await this.ipcServer.start();
    this.logger.info(`IPC server listening on ${this.config.socketPath}`);

    // Setup signal handlers
    this.setupSignalHandlers();

    this.logger.info("Marvis daemon started successfully");
  }

  private isAlreadyRunning(): boolean {
    if (!existsSync(this.config.pidFile)) return false;
    
    try {
      const pid = parseInt(readFileSync(this.config.pidFile, "utf-8").trim());
      // Check if process is running
      process.kill(pid, 0);
      return true;
    } catch {
      // Process not running, clean up stale PID file
      unlinkSync(this.config.pidFile);
      return false;
    }
  }

  private writePidFile(): void {
    writeFileSync(this.config.pidFile, process.pid.toString());
  }

  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      
      this.logger.info(`Received ${signal}, shutting down...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGHUP", () => shutdown("SIGHUP"));
  }

  private async handleRequest(request: IPCRequest): Promise<IPCResponse> {
    try {
      switch (request.type) {
        case "prompt":
          return await this.handlePrompt(request);
        case "abort":
          return this.handleAbort(request);
        case "status":
          return this.handleStatus();
        case "history":
          return await this.handleHistory(request);
        case "plugins":
          return this.handlePlugins();
        case "plugin_promote":
          return await this.handlePluginPromote(request);
        case "plugin_demote":
          return await this.handlePluginDemote(request);
        case "shutdown":
          setTimeout(() => this.shutdown(), 100);
          return { success: true, data: "Shutdown initiated" };
        default:
          return { success: false, error: `Unknown request type: ${request.type}` };
      }
    } catch (error) {
      this.logger.error("Request handling error", error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  private async handlePrompt(request: IPCRequest): Promise<IPCResponse> {
    const { message, stream } = request.data;
    
    if (stream) {
      // Return streaming response
      const chunks = this.marvis.chat(message);
      return { success: true, stream: chunks };
    } else {
      // Collect full response
      let fullResponse = "";
      for await (const chunk of this.marvis.chat(message)) {
        fullResponse += chunk;
      }
      return { success: true, data: fullResponse };
    }
  }

  private handleAbort(request: IPCRequest): IPCResponse {
    // TODO: Implement request cancellation
    return { success: true, data: "Abort not yet implemented" };
  }

  private handleStatus(): IPCResponse {
    return {
      success: true,
      data: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        pid: process.pid,
        // Add more status info
      },
    };
  }

  private async handleHistory(request: IPCRequest): Promise<IPCResponse> {
    const { conversationId, limit } = request.data || {};
    // Implementation would use memoryStore
    return { success: true, data: [] };
  }

  private handlePlugins(): IPCResponse {
    // Return plugin list with status
    return { success: true, data: [] };
  }

  private async handlePluginPromote(request: IPCRequest): Promise<IPCResponse> {
    const { pluginId } = request.data;
    await this.marvis.promotePlugin(pluginId);
    return { success: true, data: `Plugin ${pluginId} promoted to agent mode` };
  }

  private async handlePluginDemote(request: IPCRequest): Promise<IPCResponse> {
    const { pluginId } = request.data;
    await this.marvis.demotePlugin(pluginId);
    return { success: true, data: `Plugin ${pluginId} demoted to tools mode` };
  }

  async shutdown(): Promise<void> {
    this.logger.info("Shutting down Marvis daemon...");

    // Close IPC server
    if (this.ipcServer) {
      await this.ipcServer.stop();
    }

    // Shutdown Marvis core
    if (this.marvis) {
      await this.marvis.shutdown();
    }

    // Clean up PID file
    if (existsSync(this.config.pidFile)) {
      unlinkSync(this.config.pidFile);
    }

    // Clean up socket file
    if (existsSync(this.config.socketPath)) {
      unlinkSync(this.config.socketPath);
    }

    this.logger.info("Marvis daemon shut down successfully");
  }
}
```

### IPCServer

```typescript
// src/daemon/ipc-server.ts
import { createServer, Server, Socket } from "net";
import { unlinkSync, existsSync } from "fs";

interface IPCRequest {
  id: string;
  type: "prompt" | "abort" | "status" | "history" | "plugins" | "plugin_promote" | "plugin_demote" | "shutdown";
  data?: any;
}

interface IPCResponse {
  id?: string;
  success: boolean;
  data?: any;
  error?: string;
  stream?: AsyncIterable<string>;
}

type RequestHandler = (request: IPCRequest) => Promise<IPCResponse>;

class IPCServer {
  private server: Server;
  private socketPath: string;
  private handler: RequestHandler;
  private connections: Set<Socket> = new Set();

  constructor(socketPath: string, handler: RequestHandler) {
    this.socketPath = socketPath;
    this.handler = handler;
  }

  async start(): Promise<void> {
    // Clean up existing socket
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer(this.handleConnection.bind(this));
      
      this.server.on("error", reject);
      
      this.server.listen(this.socketPath, () => {
        // Set socket permissions (owner only)
        chmodSync(this.socketPath, 0o600);
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);
    
    let buffer = "";

    socket.on("data", async (data) => {
      buffer += data.toString();
      
      // Messages are newline-delimited JSON
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";  // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const request: IPCRequest = JSON.parse(line);
          const response = await this.handler(request);
          response.id = request.id;

          if (response.stream) {
            // Handle streaming response
            for await (const chunk of response.stream) {
              socket.write(JSON.stringify({ 
                id: request.id, 
                chunk,
                done: false 
              }) + "\n");
            }
            socket.write(JSON.stringify({ 
              id: request.id, 
              done: true 
            }) + "\n");
          } else {
            socket.write(JSON.stringify(response) + "\n");
          }
        } catch (error) {
          socket.write(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }) + "\n");
        }
      }
    });

    socket.on("close", () => {
      this.connections.delete(socket);
    });

    socket.on("error", (err) => {
      console.error("Socket error:", err);
      this.connections.delete(socket);
    });
  }

  async stop(): Promise<void> {
    // Close all connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    // Close server
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

// IPC Client (for CLI)
class IPCClient {
  private socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async send(request: Omit<IPCRequest, "id">): Promise<IPCResponse> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      const requestWithId: IPCRequest = {
        ...request,
        id: randomUUID(),
      };

      let buffer = "";

      socket.on("connect", () => {
        socket.write(JSON.stringify(requestWithId) + "\n");
      });

      socket.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const response = JSON.parse(line);
          if (response.id === requestWithId.id && response.done !== false) {
            socket.end();
            resolve(response);
          }
        }
      });

      socket.on("error", reject);
    });
  }

  async *sendStreaming(request: Omit<IPCRequest, "id">): AsyncGenerator<string> {
    const socket = createConnection(this.socketPath);
    const requestWithId: IPCRequest = {
      ...request,
      id: randomUUID(),
    };

    let buffer = "";

    socket.write(JSON.stringify(requestWithId) + "\n");

    for await (const data of socket) {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const response = JSON.parse(line);
        if (response.id === requestWithId.id) {
          if (response.done) {
            socket.end();
            return;
          }
          if (response.chunk) {
            yield response.chunk;
          }
        }
      }
    }
  }
}
```

---

## Section 6: CLI Interface

### MarvisCLI

```typescript
// src/cli/cli.ts
import { Command } from "commander";
import { IPCClient } from "../daemon/ipc-server";
import { REPL } from "./repl";
import { existsSync, readFileSync } from "fs";
import { spawn } from "child_process";

const DEFAULT_SOCKET = "data/marvis.sock";
const DEFAULT_PID_FILE = "data/marvis.pid";

const program = new Command();

program
  .name("marvis")
  .description("Marvis AI Assistant CLI")
  .version("1.0.0");

// Start daemon
program
  .command("start")
  .description("Start the Marvis daemon")
  .option("-f, --foreground", "Run in foreground (don't daemonize)")
  .option("-c, --config <path>", "Path to config file")
  .action(async (options) => {
    if (isDaemonRunning()) {
      console.log("Marvis daemon is already running");
      return;
    }

    if (options.foreground) {
      // Run in foreground
      const { MarvisDaemon } = await import("../daemon/daemon");
      const daemon = new MarvisDaemon(loadConfig(options.config));
      await daemon.start();
    } else {
      // Spawn detached process
      const child = spawn(process.execPath, [
        process.argv[1],
        "start",
        "--foreground",
        ...(options.config ? ["-c", options.config] : []),
      ], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      
      // Wait for daemon to start
      await waitForDaemon();
      console.log("Marvis daemon started");
    }
  });

// Stop daemon
program
  .command("stop")
  .description("Stop the Marvis daemon")
  .action(async () => {
    if (!isDaemonRunning()) {
      console.log("Marvis daemon is not running");
      return;
    }

    const client = new IPCClient(DEFAULT_SOCKET);
    await client.send({ type: "shutdown" });
    console.log("Marvis daemon stopped");
  });

// Status
program
  .command("status")
  .description("Show daemon status")
  .action(async () => {
    if (!isDaemonRunning()) {
      console.log("Marvis daemon is not running");
      return;
    }

    const client = new IPCClient(DEFAULT_SOCKET);
    const response = await client.send({ type: "status" });
    console.log("Marvis Status:");
    console.log(JSON.stringify(response.data, null, 2));
  });

// Interactive chat (default command)
program
  .command("chat", { isDefault: true })
  .description("Start interactive chat session")
  .action(async () => {
    if (!isDaemonRunning()) {
      console.log("Starting Marvis daemon...");
      await startDaemonBackground();
    }

    const client = new IPCClient(DEFAULT_SOCKET);
    const repl = new REPL(client);
    await repl.start();
  });

// One-shot prompt
program
  .command("ask <message...>")
  .description("Send a single message and get response")
  .option("-s, --stream", "Stream the response")
  .action(async (messageParts: string[], options) => {
    if (!isDaemonRunning()) {
      console.log("Starting Marvis daemon...");
      await startDaemonBackground();
    }

    const message = messageParts.join(" ");
    const client = new IPCClient(DEFAULT_SOCKET);

    if (options.stream) {
      for await (const chunk of client.sendStreaming({
        type: "prompt",
        data: { message, stream: true },
      })) {
        process.stdout.write(chunk);
      }
      console.log();
    } else {
      const response = await client.send({
        type: "prompt",
        data: { message, stream: false },
      });
      console.log(response.data);
    }
  });

// Plugin management
program
  .command("plugins")
  .description("List loaded plugins")
  .action(async () => {
    ensureDaemonRunning();
    const client = new IPCClient(DEFAULT_SOCKET);
    const response = await client.send({ type: "plugins" });
    console.log("Loaded Plugins:");
    // Display plugin info
  });

program
  .command("plugin:promote <id>")
  .description("Promote a plugin to agent mode")
  .action(async (id) => {
    ensureDaemonRunning();
    const client = new IPCClient(DEFAULT_SOCKET);
    const response = await client.send({ 
      type: "plugin_promote", 
      data: { pluginId: id } 
    });
    console.log(response.data);
  });

program
  .command("plugin:demote <id>")
  .description("Demote a plugin to tools mode")
  .action(async (id) => {
    ensureDaemonRunning();
    const client = new IPCClient(DEFAULT_SOCKET);
    const response = await client.send({ 
      type: "plugin_demote", 
      data: { pluginId: id } 
    });
    console.log(response.data);
  });

// Helper functions
function isDaemonRunning(): boolean {
  if (!existsSync(DEFAULT_PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(DEFAULT_PID_FILE, "utf-8").trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForDaemon(timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (existsSync(DEFAULT_SOCKET)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("Daemon failed to start");
}

async function startDaemonBackground(): Promise<void> {
  const child = spawn(process.execPath, [
    process.argv[1],
    "start",
    "--foreground",
  ], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await waitForDaemon();
}

function ensureDaemonRunning(): void {
  if (!isDaemonRunning()) {
    console.error("Marvis daemon is not running. Start with: marvis start");
    process.exit(1);
  }
}

function loadConfig(configPath?: string): DaemonConfig {
  // Load and merge config
  return {
    socketPath: DEFAULT_SOCKET,
    pidFile: DEFAULT_PID_FILE,
    logFile: "data/marvis.log",
    marvisConfig: {},
  };
}

program.parse();
```

### REPL

```typescript
// src/cli/repl.ts
import * as readline from "readline";
import { IPCClient } from "../daemon/ipc-server";
import { SlashCommands } from "./commands";

class REPL {
  private client: IPCClient;
  private rl: readline.Interface;
  private commands: SlashCommands;
  private running = true;

  constructor(client: IPCClient) {
    this.client = client;
    this.commands = new SlashCommands(client);
  }

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "marvis> ",
    });

    console.log("Marvis Interactive Chat");
    console.log("Type /help for available commands, /exit to quit\n");

    this.rl.prompt();

    this.rl.on("line", async (line) => {
      const input = line.trim();
      
      if (!input) {
        this.rl.prompt();
        return;
      }

      // Handle slash commands
      if (input.startsWith("/")) {
        const handled = await this.commands.handle(input);
        if (input === "/exit") {
          this.running = false;
          this.rl.close();
          return;
        }
        if (handled) {
          this.rl.prompt();
          return;
        }
      }

      // Send to Marvis
      try {
        process.stdout.write("\n");
        for await (const chunk of this.client.sendStreaming({
          type: "prompt",
          data: { message: input, stream: true },
        })) {
          process.stdout.write(chunk);
        }
        process.stdout.write("\n\n");
      } catch (error) {
        console.error("Error:", error);
      }

      this.rl.prompt();
    });

    this.rl.on("close", () => {
      if (this.running) {
        console.log("\nGoodbye!");
      }
    });
  }
}
```

### SlashCommands

```typescript
// src/cli/commands.ts
import { IPCClient } from "../daemon/ipc-server";

class SlashCommands {
  private client: IPCClient;

  constructor(client: IPCClient) {
    this.client = client;
  }

  async handle(input: string): Promise<boolean> {
    const [command, ...args] = input.slice(1).split(/\s+/);

    switch (command) {
      case "help":
        this.showHelp();
        return true;

      case "exit":
      case "quit":
        console.log("Goodbye!");
        return true;

      case "status":
        await this.showStatus();
        return true;

      case "new":
        await this.newConversation();
        return true;

      case "history":
        await this.showHistory(args[0] ? parseInt(args[0]) : 10);
        return true;

      case "clear":
        console.clear();
        return true;

      case "plugins":
        await this.listPlugins();
        return true;

      case "promote":
        if (args[0]) {
          await this.promotePlugin(args[0]);
        } else {
          console.log("Usage: /promote <plugin_id>");
        }
        return true;

      case "demote":
        if (args[0]) {
          await this.demotePlugin(args[0]);
        } else {
          console.log("Usage: /demote <plugin_id>");
        }
        return true;

      default:
        console.log(`Unknown command: /${command}. Type /help for available commands.`);
        return true;
    }
  }

  private showHelp(): void {
    console.log(`
Available Commands:
  /help           Show this help message
  /exit, /quit    Exit the chat
  /status         Show Marvis status
  /new            Start a new conversation
  /history [n]    Show last n messages (default: 10)
  /clear          Clear the screen
  /plugins        List loaded plugins
  /promote <id>   Promote plugin to agent mode
  /demote <id>    Demote plugin to tools mode
`);
  }

  private async showStatus(): Promise<void> {
    const response = await this.client.send({ type: "status" });
    if (response.success) {
      console.log("\nMarvis Status:");
      console.log(`  Uptime: ${Math.floor(response.data.uptime)}s`);
      console.log(`  Memory: ${Math.round(response.data.memoryUsage.heapUsed / 1024 / 1024)}MB`);
      console.log(`  PID: ${response.data.pid}`);
    } else {
      console.log("Failed to get status:", response.error);
    }
  }

  private async newConversation(): Promise<void> {
    // Would send IPC request to create new conversation
    console.log("Started new conversation");
  }

  private async showHistory(limit: number): Promise<void> {
    const response = await this.client.send({
      type: "history",
      data: { limit },
    });
    // Display history
  }

  private async listPlugins(): Promise<void> {
    const response = await this.client.send({ type: "plugins" });
    // Display plugins
  }

  private async promotePlugin(id: string): Promise<void> {
    const response = await this.client.send({
      type: "plugin_promote",
      data: { pluginId: id },
    });
    console.log(response.success ? response.data : response.error);
  }

  private async demotePlugin(id: string): Promise<void> {
    const response = await this.client.send({
      type: "plugin_demote",
      data: { pluginId: id },
    });
    console.log(response.success ? response.data : response.error);
  }
}
```

### Entry Points

```typescript
// bin/marvis.ts
#!/usr/bin/env node
import "../src/cli/cli";

// bin/marvis-daemon.ts
#!/usr/bin/env node
import { MarvisDaemon } from "../src/daemon/daemon";

// Direct daemon entry for development
const daemon = new MarvisDaemon({
  socketPath: "data/marvis.sock",
  pidFile: "data/marvis.pid",
  logFile: "data/marvis.log",
  marvisConfig: {},
});

daemon.start().catch(console.error);
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Project setup (package.json, tsconfig, directory structure)
- [ ] Core types and interfaces
- [ ] Basic MemoryStore with SQLite
- [ ] Minimal Marvis class wrapping Pi Agent

### Phase 2: Daemon & IPC (Week 2)
- [ ] IPCServer and IPCClient
- [ ] MarvisDaemon with lifecycle management
- [ ] CLI with start/stop/status commands

### Phase 3: Plugin System (Week 3)
- [ ] Plugin interface and BasePlugin
- [ ] PluginManager with loading/unloading
- [ ] Shell plugin implementation
- [ ] Files plugin implementation

### Phase 4: Intelligence (Week 4)
- [ ] ModelRouter with local/cloud routing
- [ ] ContextManager with history management
- [ ] Web plugin implementation
- [ ] REPL improvements

### Future Phases
- Voice interface integration
- Additional plugins (productivity, smart home, etc.)
- Semantic memory with embeddings
- Multi-agent orchestration enhancements

---

## Appendix: Pi Framework Reference

### Key Pi Agent APIs Used

```typescript
// Agent creation
const agent = new Agent({
  tools: AgentTool[],
  systemPrompt: string,
  api: Api,
  model: string,
});

// Running agent
const response = await agent.run(message);
const stream = agent.runStreaming(message);

// Tool definition
const tool: AgentTool = {
  name: string,
  description: string,
  parameters: TSchema,  // TypeBox schema
  execute: async (params) => any,
};
```

### Pi AI APIs Used

```typescript
// API creation
const api = createApi({ provider: "ollama" | "anthropic" | ... });

// Chat completion
const response = await api.chat({
  model: string,
  messages: ChatMessage[],
  tools?: Tool[],
});
```
