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

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      if (usedTokens + msg.tokensEstimated > availableTokens) {
        break;
      }

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
