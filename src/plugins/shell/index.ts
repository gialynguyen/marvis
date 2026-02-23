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
        dangerLevel: "dangerous",
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
        dangerLevel: "safe",
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
