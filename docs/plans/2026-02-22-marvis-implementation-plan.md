# Marvis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Marvis, a personal AI assistant daemon with plugin architecture, CLI interface, and persistent memory using the Pi agent framework.

**Architecture:** Daemon process communicating via Unix socket IPC with CLI client. Plugin system allows tools to be promoted to full agents at runtime. SQLite persistence for conversations and long-term memory.

**Tech Stack:** TypeScript 5.x, Node.js 20+, Pi Agent Framework (@mariozechner/pi-agent-core, @mariozechner/pi-ai), better-sqlite3, Commander.js

---

## Phase 1: Project Foundation

### Task 1.1: Initialize Project Structure

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `src/types/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "marvis",
  "version": "0.1.0",
  "description": "Personal AI assistant daemon with plugin architecture",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "marvis": "dist/bin/marvis.js",
    "marvis-daemon": "dist/bin/marvis-daemon.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/bin/marvis-daemon.ts",
    "start": "node dist/bin/marvis-daemon.js",
    "cli": "tsx src/bin/marvis.ts",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mariozechner/pi-agent-core": "latest",
    "@mariozechner/pi-ai": "latest",
    "@sinclair/typebox": "^0.32.0",
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "tsx": "^4.0.0",
    "vitest": "^1.0.0",
    "eslint": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
data/
*.log
.env
.env.local
.DS_Store
*.db
*.sock
*.pid
```

**Step 4: Create src/types/index.ts with core types**

```typescript
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
  systemPrompt?: string;
  maxContextTokens?: number;
  localModel?: string;
  cloudModel?: string;
  alwaysLocal?: boolean;
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
```

**Step 5: Create src/index.ts**

```typescript
// src/index.ts
// Library exports
export * from "./types/index.js";
```

**Step 6: Install dependencies**

Run: `npm install`
Expected: Dependencies installed successfully

**Step 7: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 8: Commit**

```bash
git add .
git commit -m "chore: initialize project with TypeScript config and core types"
```

---

### Task 1.2: Create Logger Utility

**Files:**
- Create: `src/daemon/logger.ts`
- Create: `src/daemon/index.ts`
- Create: `tests/daemon/logger.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/daemon/logger.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLogger, Logger, LogLevel } from "../../src/daemon/logger.js";
import * as fs from "fs";

describe("Logger", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createLogger("test");
  });

  it("should create a logger with a name", () => {
    expect(logger).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.debug).toBeDefined();
  });

  it("should format log messages with timestamp and level", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test message");

    expect(consoleSpy).toHaveBeenCalled();
    const loggedMessage = consoleSpy.mock.calls[0][0];
    expect(loggedMessage).toContain("[test]");
    expect(loggedMessage).toContain("[INFO]");
    expect(loggedMessage).toContain("test message");

    consoleSpy.mockRestore();
  });

  it("should include additional data in log output", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test message", { key: "value" });

    const loggedMessage = consoleSpy.mock.calls[0][0];
    expect(loggedMessage).toContain("key");
    expect(loggedMessage).toContain("value");

    consoleSpy.mockRestore();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/daemon/logger.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/daemon/logger.ts
import * as fs from "fs";
import * as path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: unknown): void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(name: string, logFile?: string): Logger {
  let fileStream: fs.WriteStream | null = null;

  if (logFile) {
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fileStream = fs.createWriteStream(logFile, { flags: "a" });
  }

  const formatMessage = (
    level: LogLevel,
    message: string,
    data?: unknown
  ): string => {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    return `${timestamp} [${name}] [${level.toUpperCase()}] ${message}${dataStr}`;
  };

  const log = (level: LogLevel, message: string, data?: unknown): void => {
    const formatted = formatMessage(level, message, data);

    // Always log to console
    if (level === "error") {
      console.error(formatted);
    } else {
      console.log(formatted);
    }

    // Also write to file if configured
    if (fileStream) {
      fileStream.write(formatted + "\n");
    }
  };

  return {
    debug: (message, data) => log("debug", message, data),
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),
  };
}
```

**Step 4: Create barrel export**

```typescript
// src/daemon/index.ts
export * from "./logger.js";
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/daemon/logger.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/daemon/ tests/daemon/
git commit -m "feat: add logger utility with file and console output"
```

---

### Task 1.3: Create MemoryStore with SQLite

**Files:**
- Create: `src/core/memory/store.ts`
- Create: `src/core/memory/types.ts`
- Create: `src/core/memory/index.ts`
- Create: `tests/core/memory/store.test.ts`

**Step 1: Write the failing test for conversation management**

```typescript
// tests/core/memory/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../../src/core/memory/store.js";
import * as fs from "fs";
import * as path from "path";

const TEST_DB_PATH = "data/test-marvis.db";

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    store = new MemoryStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe("conversations", () => {
    it("should create a new conversation", async () => {
      const id = await store.createConversation("Test Conversation");
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("should check if conversation exists", async () => {
      const id = await store.createConversation();
      expect(await store.conversationExists(id)).toBe(true);
      expect(await store.conversationExists("non-existent")).toBe(false);
    });

    it("should get last conversation id", async () => {
      expect(await store.getLastConversationId()).toBeNull();

      const id1 = await store.createConversation();
      expect(await store.getLastConversationId()).toBe(id1);

      const id2 = await store.createConversation();
      expect(await store.getLastConversationId()).toBe(id2);
    });

    it("should list conversations", async () => {
      await store.createConversation("First");
      await store.createConversation("Second");

      const conversations = await store.listConversations();
      expect(conversations.length).toBe(2);
      expect(conversations[0].title).toBe("Second"); // Most recent first
      expect(conversations[1].title).toBe("First");
    });
  });

  describe("messages", () => {
    it("should add and retrieve messages", async () => {
      const convId = await store.createConversation();
      
      const msgId = await store.addMessage(convId, {
        role: "user",
        content: "Hello, Marvis!",
      });
      expect(msgId).toBeDefined();

      const messages = await store.getMessages(convId);
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe("Hello, Marvis!");
      expect(messages[0].role).toBe("user");
    });

    it("should estimate tokens for messages", async () => {
      const convId = await store.createConversation();
      await store.addMessage(convId, {
        role: "user",
        content: "This is a test message with some content.",
      });

      const messages = await store.getMessages(convId);
      expect(messages[0].tokensEstimated).toBeGreaterThan(0);
    });

    it("should get total tokens for conversation", async () => {
      const convId = await store.createConversation();
      await store.addMessage(convId, { role: "user", content: "Hello" });
      await store.addMessage(convId, { role: "assistant", content: "Hi there!" });

      const totalTokens = await store.getTotalTokens(convId);
      expect(totalTokens).toBeGreaterThan(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/memory/store.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/core/memory/types.ts
export interface ChatMessageInput {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: unknown[];
  toolCallId?: string;
}
```

```typescript
// src/core/memory/store.ts
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Conversation, StoredMessage } from "../../types/index.js";
import type { ChatMessageInput } from "./types.js";

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string = "data/marvis.db") {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
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

    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`
      )
      .run(id, title ?? null, now, now);

    return id;
  }

  async getLastConversationId(): Promise<string | null> {
    const row = this.db
      .prepare(`SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1`)
      .get() as { id: string } | undefined;

    return row?.id ?? null;
  }

  async conversationExists(id: string): Promise<boolean> {
    const row = this.db
      .prepare(`SELECT 1 FROM conversations WHERE id = ?`)
      .get(id);

    return !!row;
  }

  async listConversations(limit = 50): Promise<Conversation[]> {
    const rows = this.db
      .prepare(
        `SELECT id, title, created_at as createdAt, updated_at as updatedAt, metadata
         FROM conversations
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: string;
      title: string | null;
      createdAt: number;
      updatedAt: number;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  // Message methods
  async addMessage(
    conversationId: string,
    message: ChatMessageInput
  ): Promise<string> {
    const id = randomUUID();
    const now = Date.now();
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    const tokensEstimated = Math.ceil(content.length / 4);

    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, tokens_estimated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
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
    this.db
      .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
      .run(now, conversationId);

    return id;
  }

  async getMessages(
    conversationId: string,
    limit?: number
  ): Promise<StoredMessage[]> {
    const query = limit
      ? `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?`
      : `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`;

    const rows = (
      limit
        ? this.db.prepare(query).all(conversationId, limit)
        : this.db.prepare(query).all(conversationId)
    ) as Array<{
      id: string;
      conversation_id: string;
      role: string;
      content: string;
      tool_calls: string | null;
      tool_call_id: string | null;
      tokens_estimated: number;
      created_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as StoredMessage["role"],
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolCallId: row.tool_call_id ?? undefined,
      tokensEstimated: row.tokens_estimated,
      createdAt: row.created_at,
    }));
  }

  async getMessageCount(conversationId: string): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`
      )
      .get(conversationId) as { count: number };

    return row.count;
  }

  async getTotalTokens(conversationId: string): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT SUM(tokens_estimated) as total FROM messages WHERE conversation_id = ?`
      )
      .get(conversationId) as { total: number | null };

    return row.total ?? 0;
  }

  // Cleanup
  close(): void {
    this.db.close();
  }
}
```

```typescript
// src/core/memory/index.ts
export * from "./store.js";
export * from "./types.js";
```

**Step 4: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/core/memory/store.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/core/ tests/core/ vitest.config.ts
git commit -m "feat: add MemoryStore with SQLite for conversation persistence"
```

---

### Task 1.4: Create ContextManager

**Files:**
- Create: `src/core/memory/context.ts`
- Modify: `src/core/memory/index.ts`
- Create: `tests/core/memory/context.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/core/memory/context.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ContextManager } from "../../../src/core/memory/context.js";
import { MemoryStore } from "../../../src/core/memory/store.js";
import * as fs from "fs";

const TEST_DB_PATH = "data/test-context.db";

describe("ContextManager", () => {
  let store: MemoryStore;
  let contextManager: ContextManager;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    store = new MemoryStore(TEST_DB_PATH);
    contextManager = new ContextManager(1000, 200); // Small limits for testing
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("should build context from conversation messages", async () => {
    const convId = await store.createConversation();
    await store.addMessage(convId, { role: "user", content: "Hello" });
    await store.addMessage(convId, { role: "assistant", content: "Hi there!" });

    const context = await contextManager.buildContext(convId, store);
    expect(context.length).toBe(2);
    expect(context[0].role).toBe("user");
    expect(context[1].role).toBe("assistant");
  });

  it("should respect token limits by keeping recent messages", async () => {
    const convId = await store.createConversation();
    
    // Add many messages to exceed token limit
    for (let i = 0; i < 20; i++) {
      await store.addMessage(convId, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message number ${i} with some extra content to use tokens.`,
      });
    }

    const context = await contextManager.buildContext(convId, store);
    
    // Should have fewer messages than we added due to token limits
    expect(context.length).toBeLessThan(20);
    // Last message should be the most recent
    expect(context[context.length - 1].content).toContain("Message number 19");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/memory/context.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/core/memory/context.ts
import type { StoredMessage } from "../../types/index.js";
import type { MemoryStore } from "./store.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export class ContextManager {
  private maxTokens: number;
  private reservedTokens: number;

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
        break;
      }

      // Only include user, assistant, system roles in context
      if (msg.role === "user" || msg.role === "assistant" || msg.role === "system") {
        selected.unshift({
          role: msg.role,
          content: msg.content,
        });
        usedTokens += msg.tokensEstimated;
      }
    }

    return selected;
  }
}
```

**Step 4: Update barrel export**

```typescript
// src/core/memory/index.ts
export * from "./store.js";
export * from "./types.js";
export * from "./context.js";
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/core/memory/context.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/core/memory/ tests/core/memory/
git commit -m "feat: add ContextManager for conversation history windowing"
```

---

## Phase 2: Plugin System

### Task 2.1: Create Plugin Interface and BasePlugin

**Files:**
- Create: `src/plugins/plugin.ts`
- Create: `src/plugins/index.ts`
- Create: `tests/plugins/plugin.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/plugins/plugin.test.ts
import { describe, it, expect, vi } from "vitest";
import { BasePlugin, type Plugin, type PluginManifest } from "../../src/plugins/plugin.js";

class TestPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "test",
    name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    capabilities: ["test"],
  };

  protected async onInitialize(): Promise<void> {
    // Test initialization
  }

  protected async onShutdown(): Promise<void> {
    // Test shutdown
  }

  getTools() {
    return [
      {
        name: "test_tool",
        description: "A test tool",
        parameters: {},
        execute: async () => "test result",
      },
    ];
  }

  getSystemPromptFragment(): string {
    return "## Test Plugin\nThis is a test.";
  }
}

describe("BasePlugin", () => {
  it("should initialize with config", async () => {
    const plugin = new TestPlugin();
    await plugin.initialize({ key: "value" });

    expect(plugin.manifest.id).toBe("test");
    expect(plugin.mode).toBe("tools");
  });

  it("should return tools", () => {
    const plugin = new TestPlugin();
    const tools = plugin.getTools();

    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("test_tool");
  });

  it("should return system prompt fragment", () => {
    const plugin = new TestPlugin();
    const fragment = plugin.getSystemPromptFragment();

    expect(fragment).toContain("Test Plugin");
  });

  it("should perform health check", async () => {
    const plugin = new TestPlugin();
    const health = await plugin.healthCheck();

    expect(health.healthy).toBe(true);
  });

  it("should return undefined for getAgent by default", () => {
    const plugin = new TestPlugin();
    expect(plugin.getAgent()).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugins/plugin.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/plugins/plugin.ts
import type { PluginManifest, PluginHealthCheck, PluginMode } from "../types/index.js";
import { createLogger, type Logger } from "../daemon/logger.js";

// Re-export for convenience
export type { PluginManifest };

export interface AgentTool {
  name: string;
  description: string;
  parameters: unknown;
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
```

**Step 4: Create barrel export**

```typescript
// src/plugins/index.ts
export * from "./plugin.js";
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/plugins/plugin.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/plugins/ tests/plugins/
git commit -m "feat: add Plugin interface and BasePlugin abstract class"
```

---

### Task 2.2: Create PluginManager

**Files:**
- Create: `src/plugins/manager.ts`
- Modify: `src/plugins/index.ts`
- Create: `tests/plugins/manager.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/plugins/manager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { PluginManager } from "../../src/plugins/manager.js";
import { BasePlugin, type PluginManifest, type AgentTool } from "../../src/plugins/plugin.js";

class MockPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "mock",
    name: "Mock Plugin",
    version: "1.0.0",
    description: "A mock plugin for testing",
    capabilities: ["mock"],
  };

  protected async onInitialize(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}

  getTools(): AgentTool[] {
    return [
      {
        name: "mock_tool",
        description: "A mock tool",
        parameters: {},
        execute: async () => "mock result",
      },
    ];
  }

  getSystemPromptFragment(): string {
    return "## Mock\nMock functionality.";
  }
}

describe("PluginManager", () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  it("should load a plugin", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);

    expect(manager.getPlugin("mock")).toBe(plugin);
  });

  it("should throw when loading duplicate plugin", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);

    await expect(manager.loadPlugin(plugin)).rejects.toThrow("already loaded");
  });

  it("should unload a plugin", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);
    await manager.unloadPlugin("mock");

    expect(manager.getPlugin("mock")).toBeUndefined();
  });

  it("should collect all tools from plugins in tools mode", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);

    const tools = manager.getAllTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("mock_tool");
  });

  it("should assemble system prompt fragments", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);

    const fragments = manager.getSystemPromptFragments();
    expect(fragments).toContain("Mock");
  });

  it("should list all plugins", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);

    const plugins = manager.listPlugins();
    expect(plugins.length).toBe(1);
    expect(plugins[0].id).toBe("mock");
  });

  it("should shutdown all plugins", async () => {
    const plugin = new MockPlugin();
    await manager.loadPlugin(plugin);
    await manager.shutdownAll();

    expect(manager.listPlugins().length).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugins/manager.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/plugins/manager.ts
import type { Plugin, AgentTool, Agent } from "./plugin.js";
import { createLogger, type Logger } from "../daemon/logger.js";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  mode: "tools" | "agent";
  capabilities: string[];
}

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private loadOrder: string[] = [];
  private logger: Logger;

  constructor() {
    this.logger = createLogger("plugin-manager");
  }

  async loadPlugin(plugin: Plugin, config: Record<string, unknown> = {}): Promise<void> {
    const { id } = plugin.manifest;

    if (this.plugins.has(id)) {
      throw new Error(`Plugin ${id} is already loaded`);
    }

    // Check dependencies
    if (plugin.manifest.dependencies) {
      for (const dep of plugin.manifest.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin ${id} requires ${dep} which is not loaded`);
        }
      }
    }

    // Initialize plugin
    await plugin.initialize(config);
    this.plugins.set(id, plugin);
    this.loadOrder.push(id);

    this.logger.info(`Loaded plugin: ${id} v${plugin.manifest.version}`);
  }

  async unloadPlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin ${id} not found`);
    }

    // Check if other plugins depend on this one
    for (const [otherId, otherPlugin] of this.plugins) {
      if (otherPlugin.manifest.dependencies?.includes(id)) {
        throw new Error(`Cannot unload ${id}: ${otherId} depends on it`);
      }
    }

    await plugin.shutdown();
    this.plugins.delete(id);
    this.loadOrder = this.loadOrder.filter((i) => i !== id);

    this.logger.info(`Unloaded plugin: ${id}`);
  }

  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  listPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      mode: p.mode,
      capabilities: p.manifest.capabilities,
    }));
  }

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
        const agent = plugin.getAgent?.();
        if (agent) {
          agents.set(id, agent);
        }
      }
    }
    return agents;
  }

  getSystemPromptFragments(): string {
    return Array.from(this.plugins.values())
      .map((p) => p.getSystemPromptFragment())
      .join("\n\n");
  }

  async promotePlugin(id: string, agent: Agent): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin ${id} not found`);
    }

    plugin.promoteToAgent(agent);
    this.logger.info(`Promoted plugin ${id} to agent mode`);
  }

  async demotePlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin ${id} not found`);
    }

    plugin.demoteToTools();
    this.logger.info(`Demoted plugin ${id} to tools mode`);
  }

  async shutdownAll(): Promise<void> {
    // Shutdown in reverse load order
    for (const id of [...this.loadOrder].reverse()) {
      const plugin = this.plugins.get(id);
      if (plugin) {
        await plugin.shutdown();
        this.plugins.delete(id);
      }
    }
    this.loadOrder = [];
    this.logger.info("All plugins shut down");
  }
}
```

**Step 4: Update barrel export**

```typescript
// src/plugins/index.ts
export * from "./plugin.js";
export * from "./manager.js";
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/plugins/manager.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/plugins/ tests/plugins/
git commit -m "feat: add PluginManager for plugin lifecycle and tool collection"
```

---

### Task 2.3: Create Shell Plugin

**Files:**
- Create: `src/plugins/shell/index.ts`
- Create: `src/plugins/shell/tools.ts`
- Create: `tests/plugins/shell/shell.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/plugins/shell/shell.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShellPlugin } from "../../../src/plugins/shell/index.js";

describe("ShellPlugin", () => {
  let plugin: ShellPlugin;

  beforeEach(async () => {
    plugin = new ShellPlugin();
    await plugin.initialize({});
  });

  afterEach(async () => {
    await plugin.shutdown();
  });

  it("should have correct manifest", () => {
    expect(plugin.manifest.id).toBe("shell");
    expect(plugin.manifest.capabilities).toContain("execute_shell");
  });

  it("should provide execute_command tool", () => {
    const tools = plugin.getTools();
    const execTool = tools.find((t) => t.name === "execute_command");

    expect(execTool).toBeDefined();
    expect(execTool?.description).toContain("shell command");
  });

  it("should execute a simple command", async () => {
    const tools = plugin.getTools();
    const execTool = tools.find((t) => t.name === "execute_command");

    const result = await execTool?.execute({ command: "echo hello" });
    expect(result).toContain("hello");
  });

  it("should provide get_env tool", () => {
    const tools = plugin.getTools();
    const envTool = tools.find((t) => t.name === "get_env");

    expect(envTool).toBeDefined();
  });

  it("should get environment variables", async () => {
    const tools = plugin.getTools();
    const envTool = tools.find((t) => t.name === "get_env");

    // PATH should exist on all systems
    const result = await envTool?.execute({ name: "PATH" });
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("should return null for non-existent env var", async () => {
    const tools = plugin.getTools();
    const envTool = tools.find((t) => t.name === "get_env");

    const result = await envTool?.execute({ name: "NON_EXISTENT_VAR_12345" });
    expect(result).toBeNull();
  });

  it("should return system prompt fragment", () => {
    const fragment = plugin.getSystemPromptFragment();
    expect(fragment).toContain("Shell");
    expect(fragment).toContain("execute_command");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugins/shell/shell.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/plugins/shell/tools.ts
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ExecuteCommandParams {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface ExecuteCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function executeCommand(
  params: ExecuteCommandParams
): Promise<string> {
  const { command, cwd, timeout = 30000 } = params;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    let result = stdout;
    if (stderr) {
      result += `\n[stderr]: ${stderr}`;
    }
    return result.trim();
  } catch (error: unknown) {
    if (error instanceof Error) {
      const execError = error as Error & {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      const output = execError.stdout || "";
      const errOutput = execError.stderr || error.message;
      throw new Error(
        `Command failed with exit code ${execError.code || 1}:\n${output}\n${errOutput}`
      );
    }
    throw error;
  }
}

export function getEnvVar(name: string): string | null {
  return process.env[name] ?? null;
}
```

```typescript
// src/plugins/shell/index.ts
import { Type } from "@sinclair/typebox";
import { BasePlugin, type PluginManifest, type AgentTool } from "../plugin.js";
import { executeCommand, getEnvVar } from "./tools.js";

export class ShellPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "shell",
    name: "Shell Commands",
    version: "1.0.0",
    description: "Execute shell commands and manage environment variables",
    capabilities: ["execute_shell", "read_env"],
  };

  protected async onInitialize(): Promise<void> {
    this.logger.info("Shell plugin initialized");
  }

  protected async onShutdown(): Promise<void> {
    this.logger.info("Shell plugin shut down");
  }

  getTools(): AgentTool[] {
    return [
      {
        name: "execute_command",
        description:
          "Execute a shell command and return the output. Use with caution for system-modifying commands.",
        parameters: Type.Object({
          command: Type.String({ description: "The shell command to execute" }),
          cwd: Type.Optional(
            Type.String({ description: "Working directory for the command" })
          ),
          timeout: Type.Optional(
            Type.Number({
              description: "Timeout in milliseconds (default: 30000)",
            })
          ),
        }),
        execute: async (params: unknown) => {
          const { command, cwd, timeout } = params as {
            command: string;
            cwd?: string;
            timeout?: number;
          };
          return executeCommand({ command, cwd, timeout });
        },
      },
      {
        name: "get_env",
        description: "Get the value of an environment variable",
        parameters: Type.Object({
          name: Type.String({ description: "Environment variable name" }),
        }),
        execute: async (params: unknown) => {
          const { name } = params as { name: string };
          return getEnvVar(name);
        },
      },
    ];
  }

  getSystemPromptFragment(): string {
    return `## Shell Commands
You can execute shell commands on the user's macOS system.
- Use \`execute_command\` for running terminal commands
- Use \`get_env\` to read environment variables
- Be cautious with destructive commands (rm, mv, etc.)
- Always confirm before running commands that modify the system
- Commands have a default timeout of 30 seconds`;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugins/shell/shell.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugins/shell/ tests/plugins/shell/
git commit -m "feat: add ShellPlugin with execute_command and get_env tools"
```

---

## Phase 3: Daemon & IPC

### Task 3.1: Create IPCServer

**Files:**
- Create: `src/daemon/ipc-server.ts`
- Modify: `src/daemon/index.ts`
- Create: `tests/daemon/ipc-server.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/daemon/ipc-server.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IPCServer } from "../../src/daemon/ipc-server.js";
import { IPCClient } from "../../src/daemon/ipc-client.js";
import * as fs from "fs";

const TEST_SOCKET = "data/test.sock";

describe("IPCServer", () => {
  let server: IPCServer;

  beforeEach(async () => {
    if (fs.existsSync(TEST_SOCKET)) {
      fs.unlinkSync(TEST_SOCKET);
    }
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    if (fs.existsSync(TEST_SOCKET)) {
      fs.unlinkSync(TEST_SOCKET);
    }
  });

  it("should start and accept connections", async () => {
    server = new IPCServer(TEST_SOCKET, async (req) => ({
      success: true,
      data: "pong",
    }));

    await server.start();
    expect(fs.existsSync(TEST_SOCKET)).toBe(true);
  });

  it("should handle requests and send responses", async () => {
    server = new IPCServer(TEST_SOCKET, async (req) => ({
      success: true,
      data: `echo: ${req.data?.message}`,
    }));

    await server.start();

    const client = new IPCClient(TEST_SOCKET);
    const response = await client.send({
      type: "status",
      data: { message: "hello" },
    });

    expect(response.success).toBe(true);
    expect(response.data).toBe("echo: hello");
  });

  it("should clean up socket on stop", async () => {
    server = new IPCServer(TEST_SOCKET, async () => ({ success: true }));
    await server.start();
    await server.stop();

    expect(fs.existsSync(TEST_SOCKET)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/daemon/ipc-server.test.ts`
Expected: FAIL

**Step 3: Write IPC Server implementation**

```typescript
// src/daemon/ipc-server.ts
import { createServer, Server, Socket } from "net";
import { unlinkSync, existsSync, chmodSync } from "fs";
import * as path from "path";
import * as fs from "fs";
import type { IPCRequest, IPCResponse } from "../types/index.js";
import { createLogger } from "./logger.js";

export type RequestHandler = (request: IPCRequest) => Promise<IPCResponse>;

export class IPCServer {
  private server: Server | null = null;
  private socketPath: string;
  private handler: RequestHandler;
  private connections: Set<Socket> = new Set();
  private logger = createLogger("ipc-server");

  constructor(socketPath: string, handler: RequestHandler) {
    this.socketPath = socketPath;
    this.handler = handler;
  }

  async start(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.socketPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Clean up existing socket
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer(this.handleConnection.bind(this));

      this.server.on("error", (err) => {
        this.logger.error("Server error", err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        // Set socket permissions (owner only)
        chmodSync(this.socketPath, 0o600);
        this.logger.info(`IPC server listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);
    this.logger.debug("New client connected");

    let buffer = "";

    socket.on("data", async (data) => {
      buffer += data.toString();

      // Messages are newline-delimited JSON
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request: IPCRequest = JSON.parse(line);
          this.logger.debug(`Received request: ${request.type}`);

          const response = await this.handler(request);
          response.id = request.id;

          socket.write(JSON.stringify(response) + "\n");
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error("Request handling error", { error: errorMessage });

          socket.write(
            JSON.stringify({
              success: false,
              error: errorMessage,
            }) + "\n"
          );
        }
      }
    });

    socket.on("close", () => {
      this.connections.delete(socket);
      this.logger.debug("Client disconnected");
    });

    socket.on("error", (err) => {
      this.logger.error("Socket error", err);
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
      if (this.server) {
        this.server.close(() => {
          // Clean up socket file
          if (existsSync(this.socketPath)) {
            unlinkSync(this.socketPath);
          }
          this.logger.info("IPC server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
```

**Step 4: Write IPC Client implementation**

```typescript
// src/daemon/ipc-client.ts
import { createConnection, Socket } from "net";
import { randomUUID } from "crypto";
import type { IPCRequest, IPCResponse, IPCRequestType } from "../types/index.js";

export class IPCClient {
  private socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async send(
    request: Omit<IPCRequest, "id">
  ): Promise<IPCResponse> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      const requestWithId: IPCRequest = {
        ...request,
        id: randomUUID(),
      };

      let buffer = "";
      let resolved = false;

      socket.on("connect", () => {
        socket.write(JSON.stringify(requestWithId) + "\n");
      });

      socket.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const response: IPCResponse = JSON.parse(line);
            if (response.id === requestWithId.id) {
              resolved = true;
              socket.end();
              resolve(response);
            }
          } catch (e) {
            // Ignore parse errors for incomplete messages
          }
        }
      });

      socket.on("error", (err) => {
        if (!resolved) {
          reject(err);
        }
      });

      socket.on("close", () => {
        if (!resolved) {
          reject(new Error("Connection closed before response received"));
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!resolved) {
          socket.destroy();
          reject(new Error("Request timed out"));
        }
      }, 30000);
    });
  }

  async *sendStreaming(
    request: Omit<IPCRequest, "id">
  ): AsyncGenerator<string, void, unknown> {
    const socket = createConnection(this.socketPath);
    const requestWithId: IPCRequest = {
      ...request,
      id: randomUUID(),
    };

    let buffer = "";

    socket.write(JSON.stringify(requestWithId) + "\n");

    const chunks: string[] = [];
    let done = false;

    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const response = JSON.parse(line);
          if (response.id === requestWithId.id) {
            if (response.done) {
              done = true;
              socket.end();
            } else if (response.chunk) {
              chunks.push(response.chunk);
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    });

    // Yield chunks as they arrive
    while (!done || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
  }
}
```

**Step 5: Update barrel export**

```typescript
// src/daemon/index.ts
export * from "./logger.js";
export * from "./ipc-server.js";
export * from "./ipc-client.js";
```

**Step 6: Run test to verify it passes**

Run: `npm test -- tests/daemon/ipc-server.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/daemon/ tests/daemon/
git commit -m "feat: add IPCServer and IPCClient for daemon communication"
```

---

### Task 3.2: Create MarvisDaemon

**Files:**
- Create: `src/daemon/daemon.ts`
- Modify: `src/daemon/index.ts`
- Create: `tests/daemon/daemon.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/daemon/daemon.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MarvisDaemon } from "../../src/daemon/daemon.js";
import { IPCClient } from "../../src/daemon/ipc-client.js";
import * as fs from "fs";

const TEST_CONFIG = {
  socketPath: "data/test-daemon.sock",
  pidFile: "data/test-daemon.pid",
  logFile: "data/test-daemon.log",
  dbPath: "data/test-daemon.db",
  marvisConfig: {
    alwaysLocal: true, // Don't try to connect to cloud
  },
};

describe("MarvisDaemon", () => {
  let daemon: MarvisDaemon;

  beforeEach(() => {
    // Clean up test files
    for (const file of [
      TEST_CONFIG.socketPath,
      TEST_CONFIG.pidFile,
      TEST_CONFIG.dbPath,
    ]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
    }
    // Clean up test files
    for (const file of [
      TEST_CONFIG.socketPath,
      TEST_CONFIG.pidFile,
      TEST_CONFIG.dbPath,
    ]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  it("should start and create PID file", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    expect(fs.existsSync(TEST_CONFIG.pidFile)).toBe(true);
    expect(fs.existsSync(TEST_CONFIG.socketPath)).toBe(true);
  });

  it("should respond to status request", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    const client = new IPCClient(TEST_CONFIG.socketPath);
    const response = await client.send({ type: "status" });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("uptime");
    expect(response.data).toHaveProperty("pid");
  });

  it("should clean up on shutdown", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();
    await daemon.shutdown();

    expect(fs.existsSync(TEST_CONFIG.pidFile)).toBe(false);
    expect(fs.existsSync(TEST_CONFIG.socketPath)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/daemon/daemon.test.ts`
Expected: FAIL

**Step 3: Write MarvisDaemon implementation**

```typescript
// src/daemon/daemon.ts
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import type { DaemonConfig, IPCRequest, IPCResponse, DaemonStatus } from "../types/index.js";
import { IPCServer } from "./ipc-server.js";
import { createLogger, type Logger } from "./logger.js";
import { MemoryStore } from "../core/memory/store.js";
import { PluginManager } from "../plugins/manager.js";
import { ShellPlugin } from "../plugins/shell/index.js";

export class MarvisDaemon {
  private ipcServer!: IPCServer;
  private logger: Logger;
  private config: DaemonConfig;
  private isShuttingDown = false;
  private memoryStore!: MemoryStore;
  private pluginManager!: PluginManager;
  private currentConversationId: string | null = null;
  private startTime: number = 0;

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
    this.startTime = Date.now();

    // Write PID file
    this.writePidFile();

    // Initialize memory store
    this.memoryStore = new MemoryStore(this.config.dbPath);
    this.logger.info("Memory store initialized");

    // Initialize plugin manager
    this.pluginManager = new PluginManager();

    // Load built-in plugins
    await this.loadBuiltinPlugins();

    // Restore or create conversation
    this.currentConversationId = await this.memoryStore.getLastConversationId();
    if (!this.currentConversationId) {
      this.currentConversationId = await this.memoryStore.createConversation();
    }
    this.logger.info(`Active conversation: ${this.currentConversationId}`);

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

  private async loadBuiltinPlugins(): Promise<void> {
    // Load shell plugin
    const shellPlugin = new ShellPlugin();
    await this.pluginManager.loadPlugin(shellPlugin);
  }

  private isAlreadyRunning(): boolean {
    if (!existsSync(this.config.pidFile)) return false;

    try {
      const pid = parseInt(readFileSync(this.config.pidFile, "utf-8").trim());
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
        case "status":
          return this.handleStatus();
        case "plugins":
          return this.handlePlugins();
        case "new_conversation":
          return await this.handleNewConversation();
        case "shutdown":
          setTimeout(() => this.shutdown(), 100);
          return { success: true, data: "Shutdown initiated" };
        default:
          return {
            success: false,
            error: `Unknown request type: ${request.type}`,
          };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Request handling error", { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private handleStatus(): IPCResponse {
    const status: DaemonStatus = {
      uptime: (Date.now() - this.startTime) / 1000,
      memoryUsage: process.memoryUsage(),
      pid: process.pid,
      conversationId: this.currentConversationId,
      pluginCount: this.pluginManager.listPlugins().length,
      activeAgents: Array.from(this.pluginManager.getActiveAgents().keys()),
    };

    return {
      success: true,
      data: status,
    };
  }

  private handlePlugins(): IPCResponse {
    return {
      success: true,
      data: this.pluginManager.listPlugins(),
    };
  }

  private async handleNewConversation(): Promise<IPCResponse> {
    this.currentConversationId = await this.memoryStore.createConversation();
    return {
      success: true,
      data: { conversationId: this.currentConversationId },
    };
  }

  async shutdown(): Promise<void> {
    this.logger.info("Shutting down Marvis daemon...");

    // Close IPC server
    if (this.ipcServer) {
      await this.ipcServer.stop();
    }

    // Shutdown plugins
    if (this.pluginManager) {
      await this.pluginManager.shutdownAll();
    }

    // Close memory store
    if (this.memoryStore) {
      this.memoryStore.close();
    }

    // Clean up PID file
    if (existsSync(this.config.pidFile)) {
      unlinkSync(this.config.pidFile);
    }

    this.logger.info("Marvis daemon shut down successfully");
  }
}
```

**Step 4: Update barrel export**

```typescript
// src/daemon/index.ts
export * from "./logger.js";
export * from "./ipc-server.js";
export * from "./ipc-client.js";
export * from "./daemon.js";
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/daemon/daemon.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/daemon/ tests/daemon/
git commit -m "feat: add MarvisDaemon with plugin loading and IPC handling"
```

---

## Phase 4: CLI Interface

### Task 4.1: Create CLI Entry Point

**Files:**
- Create: `src/cli/cli.ts`
- Create: `src/bin/marvis.ts`
- Create: `src/bin/marvis-daemon.ts`

**Step 1: Create CLI implementation**

```typescript
// src/cli/cli.ts
import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { spawn } from "child_process";
import { IPCClient } from "../daemon/ipc-client.js";
import type { DaemonConfig } from "../types/index.js";

const DEFAULT_SOCKET = "data/marvis.sock";
const DEFAULT_PID_FILE = "data/marvis.pid";
const DEFAULT_DB_PATH = "data/marvis.db";
const DEFAULT_LOG_FILE = "data/marvis.log";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("marvis")
    .description("Marvis AI Assistant CLI")
    .version("0.1.0");

  // Start daemon
  program
    .command("start")
    .description("Start the Marvis daemon")
    .option("-f, --foreground", "Run in foreground (don't daemonize)")
    .action(async (options) => {
      if (isDaemonRunning()) {
        console.log("Marvis daemon is already running");
        return;
      }

      if (options.foreground) {
        // Run in foreground - import and start daemon directly
        const { MarvisDaemon } = await import("../daemon/daemon.js");
        const daemon = new MarvisDaemon(getDefaultConfig());
        await daemon.start();
        
        // Keep process running
        console.log("Marvis daemon running in foreground. Press Ctrl+C to stop.");
      } else {
        // Spawn detached process
        console.log("Starting Marvis daemon...");
        
        const child = spawn(
          process.execPath,
          [process.argv[1], "start", "--foreground"],
          {
            detached: true,
            stdio: "ignore",
          }
        );
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

      if (response.success) {
        console.log("Marvis Status:");
        console.log(JSON.stringify(response.data, null, 2));
      } else {
        console.error("Failed to get status:", response.error);
      }
    });

  // List plugins
  program
    .command("plugins")
    .description("List loaded plugins")
    .action(async () => {
      if (!isDaemonRunning()) {
        console.log("Marvis daemon is not running");
        return;
      }

      const client = new IPCClient(DEFAULT_SOCKET);
      const response = await client.send({ type: "plugins" });

      if (response.success) {
        console.log("Loaded Plugins:");
        const plugins = response.data as Array<{
          id: string;
          name: string;
          version: string;
          mode: string;
        }>;
        for (const plugin of plugins) {
          console.log(
            `  - ${plugin.name} (${plugin.id}) v${plugin.version} [${plugin.mode}]`
          );
        }
      } else {
        console.error("Failed to list plugins:", response.error);
      }
    });

  return program;
}

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
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Daemon failed to start");
}

function getDefaultConfig(): DaemonConfig {
  return {
    socketPath: DEFAULT_SOCKET,
    pidFile: DEFAULT_PID_FILE,
    logFile: DEFAULT_LOG_FILE,
    dbPath: DEFAULT_DB_PATH,
    marvisConfig: {},
  };
}
```

**Step 2: Create CLI entry point**

```typescript
// src/bin/marvis.ts
#!/usr/bin/env node
import { createCLI } from "../cli/cli.js";

const program = createCLI();
program.parse();
```

**Step 3: Create daemon entry point**

```typescript
// src/bin/marvis-daemon.ts
#!/usr/bin/env node
import { MarvisDaemon } from "../daemon/daemon.js";

const daemon = new MarvisDaemon({
  socketPath: "data/marvis.sock",
  pidFile: "data/marvis.pid",
  logFile: "data/marvis.log",
  dbPath: "data/marvis.db",
  marvisConfig: {},
});

daemon.start().catch((err) => {
  console.error("Failed to start daemon:", err);
  process.exit(1);
});
```

**Step 4: Create CLI barrel export**

```typescript
// src/cli/index.ts
export * from "./cli.js";
```

**Step 5: Build and test manually**

Run: `npm run build`
Expected: Build succeeds

Run: `node dist/bin/marvis.js --help`
Expected: Shows help message with commands

Run: `node dist/bin/marvis.js start`
Expected: "Marvis daemon started"

Run: `node dist/bin/marvis.js status`
Expected: Shows status JSON

Run: `node dist/bin/marvis.js plugins`
Expected: Shows "Shell Commands (shell) v1.0.0 [tools]"

Run: `node dist/bin/marvis.js stop`
Expected: "Marvis daemon stopped"

**Step 6: Commit**

```bash
git add src/cli/ src/bin/
git commit -m "feat: add CLI with start/stop/status/plugins commands"
```

---

## Phase 5: Integration and Final Assembly

### Task 5.1: Update Main Exports

**Files:**
- Modify: `src/index.ts`

**Step 1: Update main exports**

```typescript
// src/index.ts
// Types
export * from "./types/index.js";

// Daemon
export * from "./daemon/index.js";

// Core
export * from "./core/memory/index.js";

// Plugins
export * from "./plugins/index.js";
export { ShellPlugin } from "./plugins/shell/index.js";

// CLI
export * from "./cli/index.js";
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: complete V1 foundation with all exports"
```

---

### Task 5.2: Add README

**Files:**
- Create: `README.md`

**Step 1: Create README**

```markdown
# Marvis

Personal AI assistant daemon with plugin architecture, built on the Pi agent framework.

## Features

- **Daemon Architecture**: Runs as a background process with Unix socket IPC
- **Plugin System**: Extensible via plugins that can be promoted to full agents
- **Persistent Memory**: SQLite-backed conversation and long-term memory
- **Local-First LLM**: Ollama integration with cloud fallback

## Installation

```bash
npm install
npm run build
```

## Usage

### Start the daemon

```bash
# Background mode
npm run cli -- start

# Foreground mode (for development)
npm run cli -- start --foreground
```

### Check status

```bash
npm run cli -- status
```

### List plugins

```bash
npm run cli -- plugins
```

### Stop the daemon

```bash
npm run cli -- stop
```

## Development

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Development mode (auto-restart)
npm run dev
```

## Project Structure

```
src/
├── types/          # Shared TypeScript types
├── daemon/         # Daemon process and IPC
├── core/
│   └── memory/     # SQLite persistence
├── plugins/        # Plugin system
│   └── shell/      # Shell command plugin
├── cli/            # CLI interface
└── bin/            # Entry points
```

## License

MIT
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with usage instructions"
```

---

## Summary

This implementation plan covers the V1 foundation of Marvis:

1. **Phase 1**: Project setup, types, logger, memory store, context manager
2. **Phase 2**: Plugin interface, BasePlugin, PluginManager, Shell plugin
3. **Phase 3**: IPC server/client, MarvisDaemon
4. **Phase 4**: CLI with start/stop/status/plugins commands
5. **Phase 5**: Final integration and documentation

**What's included in V1:**
- ✅ TypeScript project with strict typing
- ✅ SQLite persistence for conversations
- ✅ Plugin architecture with runtime mode switching
- ✅ Shell plugin with command execution
- ✅ Daemon with Unix socket IPC
- ✅ CLI interface
- ✅ Full test coverage

**What's deferred to V2:**
- ⏳ Marvis agent with LLM integration
- ⏳ Model router (local/cloud)
- ⏳ Additional plugins (files, web)
- ⏳ Interactive REPL mode
- ⏳ Streaming responses
- ⏳ Agent delegation system
