import {
  Agent,
  type AgentToolResult,
  type AgentTool as PiAgentTool,
} from "@mariozechner/pi-agent-core";
import { getModel, type TSchema } from "@mariozechner/pi-ai";
import type { PluginManager } from "../plugins/manager";
import type { AgentTool, DangerLevel } from "../plugins/plugin";
import type { MemoryStore } from "./memory/store";

export interface MarvisAgentConfig {
  provider: string;
  model: string;
  apiKey?: string;
  systemPrompt: string;
  confirmDangerousTools: boolean;
  dangerThreshold: DangerLevel;
}

export type StreamCallback = (chunk: string) => void;
export type ConfirmCallback = (
  tool: string,
  params: unknown,
) => Promise<boolean>;

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
    conversationId: string,
  ) {
    this.config = config;
    this.pluginManager = pluginManager;
    this.memoryStore = memoryStore;
    this.conversationId = conversationId;

    this.agent = new Agent({
      initialState: {
        systemPrompt: config.systemPrompt,
        // Pi framework has strict types for getModel, but we accept arbitrary provider/model strings
        // at runtime to support custom providers. Type assertion is necessary here.
        // model: getModel(config.provider as any, config.model as any),
        model: getModel("zai", "glm-4.7"),
        tools: this.wrapPluginTools(),
        thinkingLevel: "xhigh",
      },
      getApiKey() {
        return config.apiKey;
      },
    });
  }

  setConfirmCallback(callback: ConfirmCallback): void {
    this.confirmCallback = callback;
  }

  async prompt(message: string, onChunk?: StreamCallback): Promise<string> {
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
      await this.memoryStore.addMessage(this.conversationId, {
        role: "user",
        content: message,
      });

      const messageCountBefore = this.agent.state.messages.length;
      await this.agent.prompt(message);

      // Store all new messages produced by the agent loop (assistant messages
      // with tool calls, tool result messages, and the final assistant response).
      const newMessages = this.agent.state.messages.slice(messageCountBefore);
      for (const msg of newMessages) {
        await this.storeAgentMessage(msg);
      }

      return this.extractLastAssistantText(newMessages);
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
        }
        return {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: m.content }],
          api: this.agent.state.model.api,
          provider: this.config.provider,
          model: this.config.model,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop" as const,
          timestamp: m.createdAt,
        };
      });

    this.agent.replaceMessages(agentMessages);
  }

  setModel(provider: string, model: string): void {
    this.agent.setModel(getModel(provider as any, model as any));
  }

  /**
   * Re-read tools from the plugin manager and update the agent's tool set.
   * Call this after loading or unloading plugins at runtime so that the agent
   * sees the new tool set in subsequent turns.
   */
  refreshTools(): void {
    const tools = this.wrapPluginTools();
    this.agent.setTools(tools);
  }

  /** Update agent config at runtime (hot-reload) */
  updateConfig(update: Partial<MarvisAgentConfig>): void {
    if (update.provider !== undefined || update.model !== undefined) {
      const provider = update.provider ?? this.config.provider;
      const model = update.model ?? this.config.model;
      this.setModel(provider, model);
      this.config.provider = provider;
      this.config.model = model;
    }

    if (update.apiKey !== undefined) {
      this.config.apiKey = update.apiKey;
    }

    if (update.systemPrompt !== undefined) {
      this.config.systemPrompt = update.systemPrompt;
      this.agent.setSystemPrompt(update.systemPrompt);
    }

    if (update.confirmDangerousTools !== undefined) {
      this.config.confirmDangerousTools = update.confirmDangerousTools;
    }

    if (update.dangerThreshold !== undefined) {
      this.config.dangerThreshold = update.dangerThreshold;
    }
  }

  private wrapPluginTools() {
    const tools = this.pluginManager.getAllTools();
    return tools.map((tool) => this.wrapTool(tool));
  }

  private wrapTool(tool: AgentTool): PiAgentTool {
    return {
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters as TSchema,
      execute: async (toolCallId, params, signal, onUpdate) => {
        if (this.requiresConfirmation(tool)) {
          const confirmed = await this.requestConfirmation(tool.name, params);
          if (!confirmed) {
            return {
              content: [
                { type: "text", text: "User declined to execute tool." },
              ],
            } as AgentToolResult<never>;
          }
        }

        const res = await tool.execute(params);

        return res;
      },
    } satisfies PiAgentTool;
  }

  private requiresConfirmation(tool: AgentTool): boolean {
    if (!this.config.confirmDangerousTools) return false;

    const dangerLevel = tool.dangerLevel || "safe";
    if (this.config.dangerThreshold === "dangerous") {
      return dangerLevel === "dangerous";
    }
    return dangerLevel === "dangerous" || dangerLevel === "moderate";
  }

  private async requestConfirmation(
    toolName: string,
    params: unknown,
  ): Promise<boolean> {
    if (!this.confirmCallback) return true;
    return this.confirmCallback(toolName, params);
  }

  private async storeAgentMessage(msg: any): Promise<void> {
    if (msg.role === "assistant") {
      const content = msg.content;
      const textParts = Array.isArray(content)
        ? content.filter((p: any) => p.type === "text").map((p: any) => p.text)
        : [String(content)];
      const toolCalls = Array.isArray(content)
        ? content
            .filter((p: any) => p.type === "toolCall")
            .map((p: any) => ({
              id: p.id,
              name: p.name,
              arguments: p.arguments,
            }))
        : [];

      await this.memoryStore.addMessage(this.conversationId, {
        role: "assistant",
        content: textParts.join(""),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    } else if (msg.role === "toolResult") {
      const textParts = Array.isArray(msg.content)
        ? msg.content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
        : [String(msg.content)];

      await this.memoryStore.addMessage(this.conversationId, {
        role: "tool",
        content: textParts.join(""),
        toolCallId: msg.toolCallId,
      });
    }
  }

  private extractLastAssistantText(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        const content = messages[i].content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          const textParts = content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text);
          return textParts.join("");
        }
      }
    }
    return "";
  }
}
