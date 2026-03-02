import {
  type AgentTool,
  BasePlugin,
  type PluginManifest,
  type PluginConfigDescriptor,
} from "@marvis/core";
import { Type } from "@sinclair/typebox";
import {
  type ExecuteCommandParams,
  type GetEnvVarParams,
  executeCommand,
  getEnvVar,
} from "./tools";

export class ShellPlugin extends BasePlugin {
  manifest: PluginManifest = {
    id: "shell",
    name: "Shell Commands",
    version: "1.0.0",
    description: "Execute shell commands and manage environment variables",
    capabilities: ["execute_shell", "read_env"],
  };

  configDescriptor: PluginConfigDescriptor = {
    schema: Type.Object({
      allowed_commands: Type.Optional(
        Type.Array(
          Type.String({
            description:
              "Whitelist of allowed shell commands (empty = all allowed)",
          }),
        ),
      ),
      default_timeout: Type.Optional(
        Type.Number({
          description: "Default timeout for shell commands in milliseconds",
        }),
      ),
      max_buffer_size: Type.Optional(
        Type.Number({
          description: "Maximum buffer size for command output in bytes",
        }),
      ),
    }),
    defaults: {
      default_timeout: 30000,
      max_buffer_size: 10485760,
    },
  };

  protected async onInitialize(): Promise<void> {
    this.logger.info("Shell plugin initialized");
  }

  protected async onShutdown(): Promise<void> {
    this.logger.info("Shell plugin shut down");
  }

  getTools() {
    return [
      {
        name: "execute_command",
        description:
          "Execute a shell command and return the output. Use with caution for system-modifying commands.",
        dangerLevel: "dangerous",
        parameters: Type.Object({
          command: Type.String({ description: "The shell command to execute" }),
          cwd: Type.Optional(
            Type.String({ description: "Working directory for the command" }),
          ),
          timeout: Type.Optional(
            Type.Number({
              description: "Timeout in milliseconds (default: 30000)",
            }),
          ),
        }),
        execute: async (params: ExecuteCommandParams) => {
          const { command, cwd, timeout } = params;

          const result = await executeCommand({ command, cwd, timeout });

          return {
            content: [
              {
                text: result,
                type: "text",
              },
            ],
            details: {
              command,
              cwd,
              timeout,
            },
          };
        },
      } satisfies AgentTool<ExecuteCommandParams, ExecuteCommandParams>,
      {
        name: "get_env",
        description: "Get the value of an environment variable",
        dangerLevel: "safe",
        parameters: Type.Object({
          name: Type.String({ description: "Environment variable name" }),
        }),
        execute: async (params: GetEnvVarParams) => {
          const { name } = params;
          const value = getEnvVar({ name });
          return {
            content: [
              {
                text: `Value of ${name}: ${value}`,
                type: "text",
              },
            ],
            details: {
              name,
            },
          };
        },
      } satisfies AgentTool<{ name: string }, { name: string }>,
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
