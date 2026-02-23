// src/cli/cli.ts
import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { spawn } from "child_process";
import { IPCClient } from "../daemon/ipc-client.js";
import { MarvisREPL } from "./repl.js";
import type { DaemonConfig } from "../types/index.js";
import { loadConfig } from "../core/config.js";

const DEFAULT_SOCKET = "data/marvis.sock";
const DEFAULT_PID_FILE = "data/marvis.pid";
const DEFAULT_DB_PATH = "data/marvis.db";
const DEFAULT_LOG_FILE = "data/marvis.log";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("marvis")
    .description("Marvis AI Assistant CLI")
    .version("0.1.0");

  // Start daemon
  program
    .command("start")
    .description("Start the Marvis daemon")
    .option("-f, --foreground", "Run in foreground (don't daemonize)")
    .action(async (options) => {
      if (isDaemonRunning()) {
        console.log("Marvis daemon is already running");
        return;
      }

      if (options.foreground) {
        // Run in foreground - import and start daemon directly
        const { MarvisDaemon } = await import("../daemon/daemon.js");
        const daemon = new MarvisDaemon(getDefaultConfig());
        await daemon.start();
        
        // Keep process running
        console.log("Marvis daemon running in foreground. Press Ctrl+C to stop.");
      } else {
        // Spawn detached process
        console.log("Starting Marvis daemon...");
        
        const child = spawn(
          process.execPath,
          [process.argv[1], "start", "--foreground"],
          {
            detached: true,
            stdio: "ignore",
          }
        );
        child.unref();

        // Wait for daemon to start
        try {
          await waitForDaemon();
          console.log("Marvis daemon started");
        } catch (err) {
          console.error("Failed to start daemon:", err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }
    });

  // Stop daemon
  program
    .command("stop")
    .description("Stop the Marvis daemon")
    .action(async () => {
      if (!isDaemonRunning()) {
        console.log("Marvis daemon is not running");
        return;
      }

      const client = new IPCClient(DEFAULT_SOCKET);
      await client.send({ type: "shutdown" });
      console.log("Marvis daemon stopped");
    });

  // Status
  program
    .command("status")
    .description("Show daemon status")
    .action(async () => {
      if (!isDaemonRunning()) {
        console.log("Marvis daemon is not running");
        return;
      }

      const client = new IPCClient(DEFAULT_SOCKET);
      const response = await client.send({ type: "status" });

      if (response.success) {
        console.log("Marvis Status:");
        console.log(JSON.stringify(response.data, null, 2));
      } else {
        console.error("Failed to get status:", response.error);
      }
    });

  // List plugins
  program
    .command("plugins")
    .description("List loaded plugins")
    .action(async () => {
      if (!isDaemonRunning()) {
        console.log("Marvis daemon is not running");
        return;
      }

      const client = new IPCClient(DEFAULT_SOCKET);
      const response = await client.send({ type: "plugins" });

      if (response.success) {
        console.log("Loaded Plugins:");
        const plugins = response.data as Array<{
          id: string;
          name: string;
          version: string;
          mode: string;
        }>;
        for (const plugin of plugins) {
          console.log(
            `  - ${plugin.name} (${plugin.id}) v${plugin.version} [${plugin.mode}]`
          );
        }
      } else {
        console.error("Failed to list plugins:", response.error);
      }
    });

  // Chat (REPL)
  program
    .command("chat")
    .description("Start interactive chat with Marvis")
    .action(async () => {
      if (!isDaemonRunning()) {
        console.error("Marvis daemon is not running. Start it with: marvis start");
        process.exit(1);
      }
      
      const config = getDefaultConfig();
      const repl = new MarvisREPL(config.socketPath);
      await repl.start();
    });

  return program;
}

function isDaemonRunning(): boolean {
  if (!existsSync(DEFAULT_PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(DEFAULT_PID_FILE, "utf-8").trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForDaemon(timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (existsSync(DEFAULT_SOCKET)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Daemon failed to start");
}

function getDefaultConfig(): DaemonConfig {
  return {
    socketPath: DEFAULT_SOCKET,
    pidFile: DEFAULT_PID_FILE,
    logFile: DEFAULT_LOG_FILE,
    dbPath: DEFAULT_DB_PATH,
    marvisConfig: loadConfig(),
  };
}
