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
      await this.memoryStore.addMessage(this.conversationId, { role: "user", content: message });
      await this.agent.prompt(message);

      const response = this.getLastAssistantMessage();
      await this.memoryStore.addMessage(this.conversationId, { role: "assistant", content: response });

      return response;
    } finally {
      unsubscribe();
    }
  }

  async loadConversation(conversationId: string): Promise<void> {
    this.conversationId = conversationId;
    const messages = await this.memoryStore.getMessages(conversationId);

    const agentMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        if (m.role === "user") {
          return {
            role: "user" as const,
            content: m.content,
            timestamp: m.createdAt,
          };
        } else {
          return {
            role: "assistant" as const,
            content: [{ type: "text" as const, text: m.content }],
            api: "anthropic-messages" as const,
            provider: this.config.provider,
            model: this.config.model,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop" as const,
            timestamp: m.createdAt,
          };
        }
      });

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
          return textPart && "text" in textPart ? textPart.text : "";
        }
      }
    }
    return "";
  }
}
