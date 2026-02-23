import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ExecuteCommandParams {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface ExecuteCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function executeCommand(
  params: ExecuteCommandParams,
): Promise<string> {
  const { command, cwd, timeout = 30000 } = params;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });

    let result = stdout;
    if (stderr) {
      result += `\n[stderr]: ${stderr}`;
    }
    return result.trim();
  } catch (error: unknown) {
    if (error instanceof Error) {
      const execError = error as Error & {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      const output = execError.stdout || "";
      const errOutput = execError.stderr || error.message;
      throw new Error(
        `Command failed with exit code ${execError.code || 1}:\n${output}\n${errOutput}`,
      );
    }
    throw error;
  }
}

export interface GetEnvVarParams {
  name: string;
}

export function getEnvVar(params: GetEnvVarParams): string | null {
  return process.env[params.name] ?? null;
}
