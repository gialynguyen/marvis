import * as readline from "node:readline";
import { IPCClient } from "@marvis/core";

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
  readonly PROMPT = "user> ";
  private client: IPCClient;
  private running = false;

  constructor(socketPath: string) {
    this.client = new IPCClient(socketPath);
  }

  async start(): Promise<void> {
    this.running = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.PROMPT,
    });

    this.printWelcome();

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

  private printWelcome(): void {
    console.log(
      "Hi! I'm Marvis, your AI assistant. Type /help for commands, /quit to exit.\n",
    );
  }

  private async sendPrompt(message: string): Promise<void> {
    try {
      for await (const chunk of this.client.sendStreaming({
        type: "prompt",
        data: { message },
      })) {
        process.stdout.write(chunk);
      }
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
      case "conversations":
        await this.listConversations();
        break;
      case "switch":
        await this.switchConversation(parsed.args);
        break;
      case "model":
        await this.switchModel(parsed.args);
        break;
      case "quit":
      case "exit":
        this.stop();
        break;
      default:
        console.log(
          `Unknown command: /${parsed.command}. Type /help for available commands.`,
        );
    }
  }

  private showHelp(): void {
    console.log(`
Commands:
  /new              Start a new conversation
  /history          Show conversation history
  /conversations    List all conversations
  /switch <id>      Switch to a conversation (partial ID ok)
  /model <p> <m>    Switch model (e.g., /model anthropic claude-sonnet-4-0)
  /quit             Exit REPL
`);
  }

  private async newConversation(): Promise<void> {
    const response = await this.client.send({
      type: "new_conversation",
    });
    if (response.success) {
      console.log("Started new conversation.");
    }
  }

  private async showHistory(): Promise<void> {
    const response = await this.client.send({
      type: "history",
    });
    if (response.success && response.data) {
      const messages = response.data as Array<{
        role: string;
        content: string;
      }>;
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

  private async listConversations(): Promise<void> {
    const response = await this.client.send({
      type: "list_conversations",
    });
    if (response.success && response.data) {
      const conversations = response.data as Array<{
        id: string;
        title: string | null;
        createdAt: number;
        updatedAt: number;
      }>;
      if (conversations.length === 0) {
        console.log("No conversations yet.");
        return;
      }
      console.log("\nConversations:\n");
      for (const conv of conversations) {
        const date = new Date(conv.updatedAt).toLocaleString();
        const title = conv.title ?? "(untitled)";
        const shortId = conv.id.slice(0, 8);
        console.log(`  ${shortId}  ${title}  (${date})`);
      }
      console.log();
    }
  }

  private async switchConversation(args: string[]): Promise<void> {
    if (args.length !== 1) {
      console.log("Usage: /switch <conversation-id>");
      return;
    }
    const response = await this.client.send({
      type: "switch_conversation",
      data: { conversationId: args[0] },
    });
    if (response.success) {
      console.log("Switched conversation.");
    } else {
      console.log(`Failed: ${response.error}`);
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

  private stop(): void {
    this.running = false;
    console.log("\nGoodbye!");
    process.exit(0);
  }
}
