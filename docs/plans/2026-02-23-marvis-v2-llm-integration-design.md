# Marvis V2 Design: LLM Integration

**Date**: 2026-02-23  
**Status**: Approved  
**Author**: AI-assisted design session

---

## Overview

V2 adds the "brain" to Marvis — LLM integration that makes the assistant actually respond to prompts. Built on the Pi framework (`@mariozechner/pi-agent-core` and `@mariozechner/pi-ai`), V2 wraps Pi's Agent class with our plugin system, memory store, and adds an interactive REPL interface.

### Core Decisions

- **Architecture**: Thin Agent Wrapper — wrap Pi's `Agent` with our integration layer
- **LLM Strategy**: Cloud-first with multi-provider support (OpenAI, Anthropic, Google)
- **Tool Execution**: Hybrid — dangerous tools require confirmation, configurable threshold
- **CLI Mode**: Interactive REPL with streaming responses
- **Memory**: Persistent conversations across sessions (using existing MemoryStore)

### V2 Scope

**In scope:**
- MarvisAgent class wrapping Pi Agent
- Multi-provider LLM support (OpenAI, Anthropic, Google)
- Tool confirmation for dangerous operations
- Interactive REPL with streaming
- Persistent conversations across sessions
- REPL commands: /new, /history, /model, /quit

**Out of scope (V3+):**
- Additional plugins (files, web)
- Agent delegation (plugin promotion to sub-agents)
- Voice interface
- Local LLM (Ollama)

---

## Section 1: Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  REPL Mode: readline, history, streaming output         ││
│  │  Commands: /new, /history, /model, /quit                ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │ IPC (Unix socket)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      MarvisDaemon                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  MarvisAgent                                             ││
│  │  - Wraps Pi Agent                                        ││
│  │  - Integrates PluginManager tools                        ││
│  │  - Manages conversation context from MemoryStore         ││
│  │  - Handles tool confirmation logic                       ││
│  └─────────────────────────────────────────────────────────┘│
│                              │                               │
│  ┌───────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ PluginManager │  │  MemoryStore   │  │   Config       │  │
│  │ (tools)       │  │  (context)     │  │   (providers)  │  │
│  └───────────────┘  └────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. User types message in REPL
2. CLI sends `prompt` request via IPC to daemon
3. MarvisAgent receives message, calls Pi Agent
4. Pi Agent streams response chunks back
5. Tool calls are intercepted for confirmation if dangerous
6. Response streamed back to CLI via IPC
7. Messages persisted to MemoryStore

---

## Section 2: MarvisAgent Class

New file: `src/core/marvis.ts`

```typescript
import { Agent, AgentTool as PiAgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { PluginManager } from "../plugins/manager.js";
import type { MemoryStore } from "./memory/store.js";
import type { AgentTool } from "../plugins/plugin.js";

export interface MarvisAgentConfig {
  provider: string;
  model: string;
  systemPrompt: string;
  confirmDangerousTools: boolean;
  dangerThreshold: "moderate" | "dangerous";
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
    // Subscribe to streaming
    const unsubscribe = this.agent.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta" &&
        onChunk
      ) {
        onChunk(event.assistantMessageEvent.delta);
      }
    });

    try {
      // Persist user message
      await this.memoryStore.addMessage(this.conversationId, "user", message);

      // Run agent
      await this.agent.prompt(message);

      // Get response and persist
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
    
    // Convert to Pi Agent format and load
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

  private wrapPluginTools(): PiAgentTool<any>[] {
    const tools = this.pluginManager.getAllTools();
    return tools.map((tool) => this.wrapTool(tool));
  }

  private wrapTool(tool: AgentTool): PiAgentTool<any> {
    return {
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters as any,
      execute: async (toolCallId, params, signal, onUpdate) => {
        // Check if confirmation required
        if (this.requiresConfirmation(tool)) {
          const confirmed = await this.requestConfirmation(tool.name, params);
          if (!confirmed) {
            return {
              content: [{ type: "text", text: "User declined to execute tool." }],
            };
          }
        }

        // Execute tool
        const result = await tool.execute(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      },
    };
  }

  private requiresConfirmation(tool: AgentTool): boolean {
    if (!this.config.confirmDangerousTools) return false;
    
    const dangerLevel = (tool as any).dangerLevel || "safe";
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
        return messages[i].content as string;
      }
    }
    return "";
  }
}
```

---

## Section 3: Tool Danger Levels

Extend `AgentTool` interface to include danger level:

```typescript
// src/plugins/plugin.ts
export interface AgentTool {
  name: string;
  description: string;
  parameters: unknown;
  dangerLevel?: "safe" | "moderate" | "dangerous";
  execute: (params: unknown) => Promise<unknown>;
}
```

### Default Danger Levels by Plugin

| Plugin | Tool | Danger Level |
|--------|------|--------------|
| shell | execute_command | dangerous |
| shell | get_env | safe |
| files (future) | read_file | safe |
| files (future) | write_file | moderate |
| files (future) | delete_file | dangerous |

### Confirmation Flow

1. Agent decides to call a dangerous tool
2. MarvisAgent intercepts before execution
3. Sends confirmation request via IPC to REPL
4. REPL displays: `Execute: execute_command({"command": "rm -rf /tmp/*"})? [y/N]`
5. User confirms or declines
6. Result sent back to agent loop

---

## Section 4: REPL Interface

New file: `src/cli/repl.ts`

```typescript
import * as readline from "readline";
import { IPCClient } from "../daemon/ipc-client.js";

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

      if (trimmed.startsWith("/")) {
        await this.handleCommand(trimmed);
      } else {
        await this.sendPrompt(trimmed);
      }

      if (this.running) {
        this.rl.prompt();
      }
    });

    this.rl.on("close", () => {
      this.running = false;
      console.log("\nGoodbye!");
      process.exit(0);
    });

    this.rl.prompt();
  }

  private async sendPrompt(message: string): Promise<void> {
    try {
      // Stream response
      await this.client.streamRequest(
        { type: "prompt", data: { message } },
        (chunk) => process.stdout.write(chunk)
      );
      console.log(); // Newline after response
    } catch (error) {
      console.error("Error:", (error as Error).message);
    }
  }

  private async handleCommand(input: string): Promise<void> {
    const [cmd, ...args] = input.slice(1).split(" ");

    switch (cmd) {
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
        await this.switchModel(args);
        break;

      case "quit":
      case "exit":
        this.running = false;
        this.rl.close();
        break;

      default:
        console.log(`Unknown command: /${cmd}. Type /help for available commands.`);
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
    const response = await this.client.send({ type: "new_conversation" });
    if (response.success) {
      console.log("Started new conversation.");
    }
  }

  private async showHistory(): Promise<void> {
    const response = await this.client.send({ type: "history" });
    if (response.success && response.data) {
      const messages = response.data as Array<{ role: string; content: string }>;
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
      type: "set_model",
      data: { provider, model },
    });
    if (response.success) {
      console.log(`Switched to ${provider}/${model}`);
    } else {
      console.log(`Failed: ${response.error}`);
    }
  }
}
```

---

## Section 5: IPC Protocol Extensions

New request types for V2:

```typescript
// src/types/index.ts
export type IPCRequestType =
  | "prompt"           // Send message, get streaming response
  | "abort"            // Cancel current operation
  | "status"           // Daemon status
  | "history"          // Get conversation history
  | "new_conversation" // Start new conversation
  | "set_model"        // Switch LLM provider/model
  | "confirm_tool"     // Response to tool confirmation request
  | "plugins"
  | "plugin_promote"
  | "plugin_demote"
  | "shutdown";

// Streaming response format
export interface IPCStreamChunk {
  id: string;
  type: "text" | "tool_start" | "tool_end" | "confirm_request" | "done";
  chunk?: string;
  toolName?: string;
  toolParams?: unknown;
}
```

### Streaming Protocol

For `prompt` requests, response is streamed as multiple chunks:

```
Client → Server: { type: "prompt", data: { message: "Hello" } }
Server → Client: { type: "text", chunk: "Hi" }
Server → Client: { type: "text", chunk: " there!" }
Server → Client: { type: "done" }
```

For tool confirmation:

```
Server → Client: { type: "confirm_request", toolName: "execute_command", toolParams: {...} }
Client → Server: { type: "confirm_tool", data: { confirmed: true } }
Server → Client: { type: "tool_start", toolName: "execute_command" }
Server → Client: { type: "tool_end", toolName: "execute_command" }
Server → Client: { type: "text", chunk: "Done!" }
Server → Client: { type: "done" }
```

---

## Section 6: Configuration

New file: `src/core/config.ts`

```typescript
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
```

### Environment Variables

```bash
# Required: At least one provider API key
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
GEMINI_API_KEY="AI..."

# Optional: Override defaults
MARVIS_PROVIDER="anthropic"
MARVIS_MODEL="claude-sonnet-4-0"
```

---

## Section 7: File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `src/core/marvis.ts` | MarvisAgent class |
| `src/core/config.ts` | Configuration types and defaults |
| `src/cli/repl.ts` | Interactive REPL |

### Modified Files

| File | Changes |
|------|---------|
| `src/types/index.ts` | Add new IPC types, stream chunk types |
| `src/plugins/plugin.ts` | Add `dangerLevel` to AgentTool |
| `src/plugins/shell/tools.ts` | Add danger levels to shell tools |
| `src/daemon/daemon.ts` | Integrate MarvisAgent, handle new IPC requests |
| `src/daemon/ipc-server.ts` | Add streaming support |
| `src/daemon/ipc-client.ts` | Add streaming support |
| `src/cli/cli.ts` | Add `chat` command for REPL |

---

## Section 8: Testing Strategy

### Unit Tests

- `tests/core/marvis.test.ts` — MarvisAgent with mocked Pi Agent
- `tests/cli/repl.test.ts` — REPL command parsing

### Integration Tests

- `tests/integration/prompt.test.ts` — Full prompt flow (daemon → agent → response)
- `tests/integration/confirmation.test.ts` — Tool confirmation flow

### Manual Testing

1. Start daemon: `npm run cli -- start`
2. Start REPL: `npm run cli -- chat`
3. Test basic prompt: "Hello, who are you?"
4. Test tool use: "What's my current directory?"
5. Test dangerous tool: "Run ls -la" (should prompt for confirmation)
6. Test commands: /new, /history, /model, /quit

---

## Summary

V2 transforms Marvis from a daemon skeleton into a functioning AI assistant by:

1. **MarvisAgent**: Wraps Pi's Agent with our tools and memory
2. **Multi-provider LLM**: OpenAI, Anthropic, Google via Pi framework
3. **Tool confirmation**: Safety layer for dangerous operations
4. **REPL interface**: Interactive chat with streaming
5. **Persistent memory**: Conversations survive restarts

This design leverages the Pi framework for heavy lifting (LLM abstraction, tool execution, streaming) while adding our value (plugin integration, safety, persistence).
