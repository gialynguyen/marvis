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
