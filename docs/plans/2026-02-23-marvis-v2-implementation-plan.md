# Marvis V2 LLM Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add LLM integration to Marvis, making it a functional AI assistant that responds to prompts via cloud providers.

**Architecture:** Thin Agent Wrapper approach — wrap Pi framework's `Agent` class with our PluginManager (tools), MemoryStore (persistence), and add interactive REPL with streaming. Tool confirmation for dangerous operations.

**Tech Stack:** TypeScript 5.x, Node.js 20+, Pi Agent Framework (@mariozechner/pi-agent-core, @mariozechner/pi-ai), readline (REPL)

---

## Phase 1: Configuration & Types

### Task 1.1: Add Configuration Module

**Files:**
- Create: `src/core/config.ts`
- Modify: `src/types/index.ts`
- Test: `tests/core/config.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/core/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, DEFAULT_CONFIG, type MarvisConfig } from "../src/core/config.js";

describe("Config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return default config when no env vars set", () => {
    const config = loadConfig();
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
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/core/config.test.ts`
Expected: FAIL with "Cannot find module '../src/core/config.js'"

**Step 3: Write implementation**

```typescript
// src/core/config.ts
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

export function loadConfig(): MarvisConfig {
  const config = structuredClone(DEFAULT_CONFIG);

  if (process.env.MARVIS_PROVIDER) {
    config.llm.provider = process.env.MARVIS_PROVIDER as MarvisConfig["llm"]["provider"];
  }

  if (process.env.MARVIS_MODEL) {
    config.llm.model = process.env.MARVIS_MODEL;
  }

  if (process.env.MARVIS_CONFIRM_DANGEROUS) {
    config.tools.confirmDangerous = process.env.MARVIS_CONFIRM_DANGEROUS !== "false";
  }

  if (process.env.MARVIS_DANGER_THRESHOLD) {
    config.tools.dangerThreshold = process.env.MARVIS_DANGER_THRESHOLD as MarvisConfig["tools"]["dangerThreshold"];
  }

  return config;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/core/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/config.ts tests/core/config.test.ts
git commit -m "feat: add configuration module with env var overrides"
```

---

### Task 1.2: Extend Types for Streaming IPC

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add new IPC types**

Add to `src/types/index.ts`:

```typescript
// Add to IPCRequestType
export type IPCRequestType =
  | "prompt"
  | "abort"
  | "status"
  | "history"
  | "new_conversation"
  | "set_model"
  | "confirm_tool"
  | "plugins"
  | "plugin_promote"
  | "plugin_demote"
  | "shutdown";

// Add new streaming types
export interface IPCStreamChunk {
  id: string;
  type: "text" | "tool_start" | "tool_end" | "confirm_request" | "done" | "error";
  chunk?: string;
  toolName?: string;
  toolParams?: unknown;
  error?: string;
}

// Add to DaemonConfig
export interface DaemonConfig {
  socketPath: string;
  pidFile: string;
  logFile: string;
  dbPath: string;
  marvisConfig: MarvisConfig;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add streaming IPC types and config to DaemonConfig"
```

---

### Task 1.3: Add Danger Level to AgentTool

**Files:**
- Modify: `src/plugins/plugin.ts`
- Modify: `src/plugins/shell/tools.ts`
- Modify: `tests/plugins/plugin.test.ts`

**Step 1: Update AgentTool interface**

In `src/plugins/plugin.ts`, update:

```typescript
export type DangerLevel = "safe" | "moderate" | "dangerous";

export interface AgentTool {
  name: string;
  description: string;
  parameters: unknown;
  dangerLevel?: DangerLevel;
  execute: (params: unknown) => Promise<unknown>;
}
```

**Step 2: Add danger levels to shell tools**

In `src/plugins/shell/tools.ts`, update:

```typescript
export function createExecuteCommandTool(): AgentTool {
  return {
    name: "execute_command",
    description: "Execute a shell command and return its output",
    dangerLevel: "dangerous",
    parameters: ExecuteCommandParams,
    execute: async (params: unknown) => {
      // ... existing implementation
    },
  };
}

export function createGetEnvTool(): AgentTool {
  return {
    name: "get_env",
    description: "Get the value of an environment variable",
    dangerLevel: "safe",
    parameters: GetEnvParams,
    execute: async (params: unknown) => {
      // ... existing implementation
    },
  };
}
```

**Step 3: Update test**

Add to `tests/plugins/plugin.test.ts`:

```typescript
it("should have danger level on tools", () => {
  const tool: AgentTool = {
    name: "test",
    description: "Test tool",
    dangerLevel: "dangerous",
    parameters: {},
    execute: async () => ({}),
  };
  expect(tool.dangerLevel).toBe("dangerous");
});
```

**Step 4: Run tests**

Run: `npm test -- --run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/plugins/plugin.ts src/plugins/shell/tools.ts tests/plugins/plugin.test.ts
git commit -m "feat: add danger level to AgentTool interface"
```

---

## Phase 2: MarvisAgent Core

### Task 2.1: Create MarvisAgent Class

**Files:**
- Create: `src/core/marvis.ts`
- Create: `tests/core/marvis.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/core/marvis.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Pi framework modules
vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn(),
    replaceMessages: vi.fn(),
    setModel: vi.fn(),
    state: { messages: [] },
  })),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(() => ({ id: "test-model" })),
}));

import { MarvisAgent } from "../src/core/marvis.js";
import type { PluginManager } from "../src/plugins/manager.js";
import type { MemoryStore } from "../src/core/memory/store.js";

describe("MarvisAgent", () => {
  let mockPluginManager: PluginManager;
  let mockMemoryStore: MemoryStore;

  beforeEach(() => {
    mockPluginManager = {
      getAllTools: vi.fn(() => []),
    } as unknown as PluginManager;

    mockMemoryStore = {
      addMessage: vi.fn(),
      getMessages: vi.fn(() => []),
    } as unknown as MemoryStore;
  });

  it("should create agent with config", () => {
    const agent = new MarvisAgent(
      {
        provider: "anthropic",
        model: "claude-sonnet-4-0",
        systemPrompt: "Test prompt",
        confirmDangerousTools: true,
        dangerThreshold: "dangerous",
      },
      mockPluginManager,
      mockMemoryStore,
      "conv-123"
    );

    expect(agent).toBeDefined();
  });

  it("should prompt and persist messages", async () => {
    const agent = new MarvisAgent(
      {
        provider: "anthropic",
        model: "claude-sonnet-4-0",
        systemPrompt: "Test prompt",
        confirmDangerousTools: true,
        dangerThreshold: "dangerous",
      },
      mockPluginManager,
      mockMemoryStore,
      "conv-123"
    );

    await agent.prompt("Hello");

    expect(mockMemoryStore.addMessage).toHaveBeenCalledWith(
      "conv-123",
      "user",
      "Hello"
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/core/marvis.test.ts`
Expected: FAIL with "Cannot find module '../src/core/marvis.js'"

**Step 3: Write implementation**

```typescript
// src/core/marvis.ts
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { PluginManager } from "../plugins/manager.js";
import type { MemoryStore } from "./memory/store.js";
import type { AgentTool, DangerLevel } from "../plugins/plugin.js";

export interface MarvisAgentConfig {
  provider: string;
  model: string;
  systemPrompt: string;
  confirmDangerousTools: boolean;
  dangerThreshold: DangerLevel;
}

export type StreamCallback = (chunk: string) => void;
export type ConfirmCallback = (tool: string, params: unknown) => Promise<boolean>;

export class MarvisAgent {
  private agent: Agent;
  private pluginManager: PluginManager;
  private memoryStore: MemoryStore;
  private conversationId: string;
  private config: MarvisAgentConfig;
  private confirmCallback?: ConfirmCallback;

  constructor(
    config: MarvisAgentConfig,
    pluginManager: PluginManager,
    memoryStore: MemoryStore,
    conversationId: string
  ) {
    this.config = config;
    this.pluginManager = pluginManager;
    this.memoryStore = memoryStore;
    this.conversationId = conversationId;

    this.agent = new Agent({
      initialState: {
        systemPrompt: config.systemPrompt,
        model: getModel(config.provider as any, config.model as any),
        tools: this.wrapPluginTools(),
      },
    });
  }

  setConfirmCallback(callback: ConfirmCallback): void {
    this.confirmCallback = callback;
  }

  async prompt(message: string, onChunk?: StreamCallback): Promise<string> {
    const unsubscribe = this.agent.subscribe((event: any) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta" &&
        onChunk
      ) {
        onChunk(event.assistantMessageEvent.delta);
      }
    });

    try {
      await this.memoryStore.addMessage(this.conversationId, "user", message);
      await this.agent.prompt(message);

      const response = this.getLastAssistantMessage();
      await this.memoryStore.addMessage(this.conversationId, "assistant", response);

      return response;
    } finally {
      unsubscribe();
    }
  }

  async loadConversation(conversationId: string): Promise<void> {
    this.conversationId = conversationId;
    const messages = await this.memoryStore.getMessages(conversationId);

    const agentMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      timestamp: m.createdAt,
    }));

    this.agent.replaceMessages(agentMessages);
  }

  setModel(provider: string, model: string): void {
    this.agent.setModel(getModel(provider as any, model as any));
  }

  private wrapPluginTools(): any[] {
    const tools = this.pluginManager.getAllTools();
    return tools.map((tool) => this.wrapTool(tool));
  }

  private wrapTool(tool: AgentTool): any {
    return {
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
        if (this.requiresConfirmation(tool)) {
          const confirmed = await this.requestConfirmation(tool.name, params);
          if (!confirmed) {
            return {
              content: [{ type: "text", text: "User declined to execute tool." }],
            };
          }
        }

        const result = await tool.execute(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      },
    };
  }

  private requiresConfirmation(tool: AgentTool): boolean {
    if (!this.config.confirmDangerousTools) return false;

    const dangerLevel = tool.dangerLevel || "safe";
    if (this.config.dangerThreshold === "dangerous") {
      return dangerLevel === "dangerous";
    }
    return dangerLevel === "dangerous" || dangerLevel === "moderate";
  }

  private async requestConfirmation(toolName: string, params: unknown): Promise<boolean> {
    if (!this.confirmCallback) return true;
    return this.confirmCallback(toolName, params);
  }

  private getLastAssistantMessage(): string {
    const messages = this.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        const content = messages[i].content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          const textPart = content.find((p: any) => p.type === "text");
          return textPart?.text || "";
        }
      }
    }
    return "";
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/core/marvis.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/marvis.ts tests/core/marvis.test.ts
git commit -m "feat: add MarvisAgent class wrapping Pi Agent"
```

---

### Task 2.2: Add Core Module Barrel Export

**Files:**
- Create: `src/core/index.ts`
- Modify: `src/index.ts`

**Step 1: Create barrel export**

```typescript
// src/core/index.ts
export * from "./config.js";
export * from "./marvis.js";
export * from "./memory/index.js";
```

**Step 2: Update main index**

Update `src/index.ts`:

```typescript
// src/index.ts
// Types
export * from "./types/index.js";

// Core
export * from "./core/index.js";

// Daemon
export * from "./daemon/index.js";

// Plugins
export * from "./plugins/index.js";
export { ShellPlugin } from "./plugins/shell/index.js";

// CLI
export * from "./cli/index.js";
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/core/index.ts src/index.ts
git commit -m "feat: add core module exports"
```

---

## Phase 3: IPC Streaming Support

### Task 3.1: Add Streaming to IPCClient

**Files:**
- Modify: `src/daemon/ipc-client.ts`
- Modify: `tests/daemon/ipc-server.test.ts`

**Step 1: Add streamRequest method to IPCClient**

In `src/daemon/ipc-client.ts`, add:

```typescript
async streamRequest(
  request: IPCRequest,
  onChunk: (chunk: IPCStreamChunk) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!this.socket) {
      reject(new Error("Not connected"));
      return;
    }

    const requestStr = JSON.stringify(request) + "\n";
    this.socket.write(requestStr);

    let buffer = "";

    const handleData = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as IPCStreamChunk;
          onChunk(chunk);
          if (chunk.type === "done" || chunk.type === "error") {
            cleanup();
            resolve();
          }
        } catch (e) {
          // Non-JSON response, treat as regular response
          cleanup();
          resolve();
        }
      }
    };

    const cleanup = () => {
      this.socket?.off("data", handleData);
    };

    this.socket.on("data", handleData);
  });
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/daemon/ipc-client.ts
git commit -m "feat: add streaming support to IPCClient"
```

---

### Task 3.2: Add Streaming to IPCServer

**Files:**
- Modify: `src/daemon/ipc-server.ts`

**Step 1: Add stream method**

In `src/daemon/ipc-server.ts`, add a method to send stream chunks:

```typescript
// Add to IPCServer class
sendStreamChunk(socket: net.Socket, chunk: IPCStreamChunk): void {
  if (!socket.destroyed) {
    socket.write(JSON.stringify(chunk) + "\n");
  }
}
```

**Step 2: Update handler type**

```typescript
export type RequestHandler = (
  request: IPCRequest,
  sendChunk?: (chunk: IPCStreamChunk) => void
) => Promise<IPCResponse>;
```

**Step 3: Update handleConnection to pass sendChunk**

In the `handleConnection` method, pass the `sendChunk` callback:

```typescript
private handleConnection(socket: net.Socket): void {
  // ... existing code ...

  const sendChunk = (chunk: IPCStreamChunk) => {
    this.sendStreamChunk(socket, chunk);
  };

  socket.on("data", async (data) => {
    // ... parse request ...
    const response = await this.handler(request, sendChunk);
    // ... send response ...
  });
}
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/daemon/ipc-server.ts
git commit -m "feat: add streaming support to IPCServer"
```

---

## Phase 4: Daemon Integration

### Task 4.1: Integrate MarvisAgent into Daemon

**Files:**
- Modify: `src/daemon/daemon.ts`
- Modify: `tests/daemon/daemon.test.ts`

**Step 1: Update daemon to create MarvisAgent**

In `src/daemon/daemon.ts`:

1. Import MarvisAgent and loadConfig
2. Add `marvisAgent` private field
3. Create MarvisAgent in `start()` after loading plugins
4. Handle `prompt` request with streaming
5. Handle `set_model`, `history` requests

```typescript
// Add imports
import { MarvisAgent } from "../core/marvis.js";
import { loadConfig } from "../core/config.js";

// Add to class
private marvisAgent!: MarvisAgent;

// In start(), after loadBuiltinPlugins():
const config = loadConfig();
this.marvisAgent = new MarvisAgent(
  {
    provider: config.llm.provider,
    model: config.llm.model,
    systemPrompt: config.system.systemPrompt,
    confirmDangerousTools: config.tools.confirmDangerous,
    dangerThreshold: config.tools.dangerThreshold,
  },
  this.pluginManager,
  this.memoryStore,
  this.currentConversationId!
);

// Add prompt handler
case "prompt":
  return this.handlePrompt(request, sendChunk);

// Add method
private async handlePrompt(
  request: IPCRequest,
  sendChunk?: (chunk: IPCStreamChunk) => void
): Promise<IPCResponse> {
  const { message } = request.data as { message: string };

  await this.marvisAgent.prompt(message, (chunk) => {
    sendChunk?.({ id: request.id, type: "text", chunk });
  });

  sendChunk?.({ id: request.id, type: "done" });
  return { id: request.id, success: true };
}
```

**Step 2: Add set_model handler**

```typescript
case "set_model":
  return this.handleSetModel(request);

private handleSetModel(request: IPCRequest): IPCResponse {
  const { provider, model } = request.data as { provider: string; model: string };
  this.marvisAgent.setModel(provider, model);
  return { id: request.id, success: true };
}
```

**Step 3: Update handleRequest signature**

```typescript
private async handleRequest(
  request: IPCRequest,
  sendChunk?: (chunk: IPCStreamChunk) => void
): Promise<IPCResponse> {
  // ... existing switch with sendChunk passed to prompt handler
}
```

**Step 4: Run tests**

Run: `npm test -- --run tests/daemon/daemon.test.ts`
Expected: Tests pass (may need to mock Pi framework)

**Step 5: Commit**

```bash
git add src/daemon/daemon.ts tests/daemon/daemon.test.ts
git commit -m "feat: integrate MarvisAgent into daemon with streaming"
```

---

## Phase 5: REPL Interface

### Task 5.1: Create REPL Module

**Files:**
- Create: `src/cli/repl.ts`
- Create: `tests/cli/repl.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/cli/repl.test.ts
import { describe, it, expect, vi } from "vitest";
import { parseCommand } from "../src/cli/repl.js";

describe("REPL", () => {
  describe("parseCommand", () => {
    it("should parse /help command", () => {
      const result = parseCommand("/help");
      expect(result).toEqual({ command: "help", args: [] });
    });

    it("should parse /model with args", () => {
      const result = parseCommand("/model openai gpt-4o");
      expect(result).toEqual({ command: "model", args: ["openai", "gpt-4o"] });
    });

    it("should return null for non-command input", () => {
      const result = parseCommand("hello world");
      expect(result).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/cli/repl.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/cli/repl.ts
import * as readline from "readline";
import { IPCClient } from "../daemon/ipc-client.js";
import type { IPCStreamChunk } from "../types/index.js";

export interface ParsedCommand {
  command: string;
  args: string[];
}

export function parseCommand(input: string): ParsedCommand | null {
  if (!input.startsWith("/")) return null;
  const parts = input.slice(1).split(" ");
  return { command: parts[0], args: parts.slice(1) };
}

export class MarvisREPL {
  private rl!: readline.Interface;
  private client: IPCClient;
  private running = false;

  constructor(socketPath: string) {
    this.client = new IPCClient(socketPath);
  }

  async start(): Promise<void> {
    await this.client.connect();
    this.running = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "marvis> ",
    });

    console.log("Marvis REPL started. Type /help for commands, /quit to exit.\n");

    this.rl.on("line", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        this.rl.prompt();
        return;
      }

      const parsed = parseCommand(trimmed);
      if (parsed) {
        await this.handleCommand(parsed);
      } else {
        await this.sendPrompt(trimmed);
      }

      if (this.running) {
        this.rl.prompt();
      }
    });

    this.rl.on("close", () => {
      this.stop();
    });

    this.rl.prompt();
  }

  private async sendPrompt(message: string): Promise<void> {
    try {
      await this.client.streamRequest(
        { id: Date.now().toString(), type: "prompt", data: { message } },
        (chunk: IPCStreamChunk) => {
          if (chunk.type === "text" && chunk.chunk) {
            process.stdout.write(chunk.chunk);
          }
        }
      );
      console.log();
    } catch (error) {
      console.error("Error:", (error as Error).message);
    }
  }

  private async handleCommand(parsed: ParsedCommand): Promise<void> {
    switch (parsed.command) {
      case "help":
        this.showHelp();
        break;
      case "new":
        await this.newConversation();
        break;
      case "history":
        await this.showHistory();
        break;
      case "model":
        await this.switchModel(parsed.args);
        break;
      case "quit":
      case "exit":
        this.stop();
        break;
      default:
        console.log(`Unknown command: /${parsed.command}. Type /help for available commands.`);
    }
  }

  private showHelp(): void {
    console.log(`
Commands:
  /new              Start a new conversation
  /history          Show conversation history
  /model <p> <m>    Switch model (e.g., /model anthropic claude-sonnet-4-0)
  /quit             Exit REPL
`);
  }

  private async newConversation(): Promise<void> {
    const response = await this.client.send({
      id: Date.now().toString(),
      type: "new_conversation",
    });
    if (response.success) {
      console.log("Started new conversation.");
    }
  }

  private async showHistory(): Promise<void> {
    const response = await this.client.send({
      id: Date.now().toString(),
      type: "history",
    });
    if (response.success && response.data) {
      const messages = response.data as Array<{ role: string; content: string }>;
      if (messages.length === 0) {
        console.log("No messages in current conversation.");
        return;
      }
      for (const msg of messages) {
        const prefix = msg.role === "user" ? "You: " : "Marvis: ";
        console.log(`${prefix}${msg.content}\n`);
      }
    }
  }

  private async switchModel(args: string[]): Promise<void> {
    if (args.length !== 2) {
      console.log("Usage: /model <provider> <model>");
      console.log("Example: /model anthropic claude-sonnet-4-0");
      return;
    }
    const [provider, model] = args;
    const response = await this.client.send({
      id: Date.now().toString(),
      type: "set_model",
      data: { provider, model },
    });
    if (response.success) {
      console.log(`Switched to ${provider}/${model}`);
    } else {
      console.log(`Failed: ${response.error}`);
    }
  }

  private stop(): void {
    this.running = false;
    console.log("\nGoodbye!");
    this.client.disconnect();
    process.exit(0);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/cli/repl.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/repl.ts tests/cli/repl.test.ts
git commit -m "feat: add REPL module with streaming support"
```

---

### Task 5.2: Add Chat Command to CLI

**Files:**
- Modify: `src/cli/cli.ts`
- Modify: `src/cli/index.ts`

**Step 1: Add chat command**

In `src/cli/cli.ts`, add:

```typescript
import { MarvisREPL } from "./repl.js";

// Add chat command
program
  .command("chat")
  .description("Start interactive chat with Marvis")
  .action(async () => {
    const config = loadCLIConfig();
    
    // Check if daemon is running
    const client = new IPCClient(config.socketPath);
    try {
      await client.connect();
      const status = await client.send({ id: "1", type: "status" });
      client.disconnect();
      
      if (!status.success) {
        console.error("Marvis daemon is not running. Start it with: marvis start");
        process.exit(1);
      }
    } catch {
      console.error("Marvis daemon is not running. Start it with: marvis start");
      process.exit(1);
    }
    
    // Start REPL
    const repl = new MarvisREPL(config.socketPath);
    await repl.start();
  });
```

**Step 2: Update barrel export**

In `src/cli/index.ts`:

```typescript
export * from "./cli.js";
export * from "./repl.js";
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/cli/cli.ts src/cli/index.ts
git commit -m "feat: add chat command to CLI for REPL mode"
```

---

## Phase 6: Final Integration

### Task 6.1: Update Daemon Exports

**Files:**
- Modify: `src/daemon/index.ts`

**Step 1: Ensure all daemon exports**

```typescript
// src/daemon/index.ts
export * from "./daemon.js";
export * from "./ipc-server.js";
export * from "./ipc-client.js";
export * from "./logger.js";
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Run all tests**

Run: `npm test -- --run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/daemon/index.ts
git commit -m "feat: finalize daemon exports for V2"
```

---

### Task 6.2: Manual End-to-End Test

**Step 1: Build project**

Run: `npm run build`
Expected: Build succeeds

**Step 2: Start daemon in foreground**

Run: `node dist/bin/marvis.js start --foreground`
Expected: "Marvis daemon started successfully"

**Step 3: In another terminal, start chat**

Run: `node dist/bin/marvis.js chat`
Expected: "Marvis REPL started. Type /help for commands..."

**Step 4: Test basic prompt**

Type: "Hello, who are you?"
Expected: Marvis responds with greeting and description

**Step 5: Test /help command**

Type: `/help`
Expected: Shows command list

**Step 6: Test /quit**

Type: `/quit`
Expected: "Goodbye!" and exit

**Step 7: Stop daemon**

Run: `node dist/bin/marvis.js stop`
Expected: "Marvis daemon stopped"

---

### Task 6.3: Update README

**Files:**
- Modify: `README.md`

**Step 1: Add chat section**

Add to README.md:

```markdown
### Chat with Marvis

```bash
# Start interactive chat (daemon must be running)
npm run cli -- chat

# Or after global install
marvis chat
```

**REPL Commands:**
- `/help` - Show available commands
- `/new` - Start a new conversation
- `/history` - Show conversation history
- `/model <provider> <model>` - Switch LLM model
- `/quit` - Exit chat

**Environment Variables:**
```bash
# Required: At least one API key
ANTHROPIC_API_KEY="sk-ant-..."
OPENAI_API_KEY="sk-..."
GEMINI_API_KEY="..."

# Optional: Override defaults
MARVIS_PROVIDER="anthropic"
MARVIS_MODEL="claude-sonnet-4-0"
MARVIS_CONFIRM_DANGEROUS="true"
```
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add chat usage and environment variables to README"
```

---

## Summary

This implementation plan covers V2 LLM integration:

1. **Phase 1**: Configuration and type extensions
2. **Phase 2**: MarvisAgent wrapping Pi Agent
3. **Phase 3**: IPC streaming support
4. **Phase 4**: Daemon integration
5. **Phase 5**: REPL interface
6. **Phase 6**: Final integration and testing

**Total Tasks**: 11
**Estimated Time**: 2-3 hours

**What's included in V2:**
- ✅ MarvisAgent with Pi Agent integration
- ✅ Multi-provider LLM support
- ✅ Tool danger levels and confirmation
- ✅ Streaming responses
- ✅ Interactive REPL
- ✅ Persistent conversations
