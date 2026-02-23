export interface ChatMessageInput {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: unknown[];
  toolCallId?: string;
}
