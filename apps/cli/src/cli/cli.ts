// src/cli/cli.ts
import { Command } from "commander";
import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { IPCClient } from "@marvis/core";
import { MarvisREPL } from "./repl";
import type { DaemonConfig, MarvisConfig } from "@marvis/config";
import { loadConfig, ensureConfigExists, ensureDirectoriesExist, PluginConfigRegistry } from "@marvis/config";
import { createTradingCommand } from "./commands/trading";
import { ShellPlugin } from "@marvis/plugin-shell";
import { TradingPlugin } from "@marvis/plugin-trading";
import { ConfigPlugin } from "@marvis/plugin-config";

// Cached config - loaded once on CLI startup
let cachedConfig: MarvisConfig | null = null;

export function resetConfigCache(): void {
  cachedConfig = null;
}
function getConfig(): MarvisConfig {
  if (!cachedConfig) {
    ensureConfigExists();
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

function getSocketPath(): string {
  return getConfig().paths.socketPath;
}

function getPidFile(): string {
  return join(getConfig().paths.dataDir, "marvis.pid");
}

function getLogFile(): string {
  const config = getConfig();
  return config.logging.file || join(config.paths.logDir, "marvis.log");
}

function getDbPath(): string {
  return join(getConfig().paths.dataDir, "marvis.db");
}

export function createCLI(): Command {
  const program = new Command();

  program.name("marvis").description("Marvis AI Assistant CLI").version("0.1.0");

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
        const { MarvisDaemon } = await import("@marvis/core");

        // 1. Create registry
        const registry = new PluginConfigRegistry();

        // 2. Create plugins
        const shellPlugin = new ShellPlugin();
        const tradingPlugin = new TradingPlugin();
        const configPlugin = new ConfigPlugin(registry);

        // 3. Register plugin config descriptors into registry
        for (const plugin of [shellPlugin, tradingPlugin]) {
          if (plugin.configDescriptor) {
            registry.register({
              pluginId: plugin.manifest.id,
              pluginName: plugin.manifest.name,
              schema: plugin.configDescriptor.schema,
              defaults: plugin.configDescriptor.defaults,
              descriptions: plugin.configDescriptor.descriptions,
            });
          }
        }

        // 4. Load config with registry-aware validation + default resolution
        resetConfigCache();
        cachedConfig = loadConfig(undefined, registry);
        const config = cachedConfig;

        ensureDirectoriesExist({
          dataDir: config.paths.dataDir,
          logDir: config.paths.logDir,
        });
        const daemonConfig = getDaemonConfig();
        const daemon = new MarvisDaemon(daemonConfig);

        // 5. Set up hot-reload: provide a function to reload config from disk
        daemon.setLoadConfigFn(() => loadConfig(undefined, registry));

        // 6. Register plugins with daemon
        daemon.registerPlugin(shellPlugin);
        daemon.registerPlugin(tradingPlugin);
        daemon.registerPlugin(configPlugin);

        await daemon.start();

        // 7. Wire ConfigPlugin's reload callback to the daemon's reload manager
        const reloadManager = daemon.getReloadManager();
        if (reloadManager) {
          configPlugin.setReloadCallback(() => reloadManager.reload());
        }

        // Keep process running
        console.log("Marvis daemon running in foreground. Press Ctrl+C to stop.");
      } else {
        // Spawn detached process
        console.log("Starting Marvis daemon...");

        const child = spawn(process.execPath, [process.argv[1], "start", "--foreground"], {
          detached: true,
          stdio: "ignore",
        });
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

      const client = new IPCClient(getSocketPath());
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

      const client = new IPCClient(getSocketPath());
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

      const client = new IPCClient(getSocketPath());
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
          console.log(`  - ${plugin.name} (${plugin.id}) v${plugin.version} [${plugin.mode}]`);
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

      const repl = new MarvisREPL(getSocketPath());
      await repl.start();
    });

  program
    .command("setup")
    .description("Initialize Marvis configuration and directories")
    .action(() => {
      const configPath =
        process.env.MARVIS_CONFIG || join(process.env.HOME || "", ".marvis", "config.toml");
      const configExisted = existsSync(configPath);
      ensureConfigExists();
      const config = loadConfig();
      const dataExisted = existsSync(config.paths.dataDir);
      const logExisted = existsSync(config.paths.logDir);
      ensureDirectoriesExist({
        dataDir: config.paths.dataDir,
        logDir: config.paths.logDir,
      });
      console.log("Marvis Setup");
      console.log(`  Config: ${configPath}${configExisted ? " (already existed)" : " (created)"}`);
      console.log(
        `  Data dir: ${config.paths.dataDir}${dataExisted ? " (already existed)" : " (created)"}`,
      );
      console.log(
        `  Log dir: ${config.paths.logDir}${logExisted ? " (already existed)" : " (created)"}`,
      );
    });

  program
    .command("health")
    .description("Check Marvis daemon health")
    .action(() => {
      const pidFile = getPidFile();
      const pidFileExists = existsSync(pidFile);
      let daemonRunning = false;
      let pid: number | null = null;
      if (pidFileExists) {
        try {
          pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim());
          process.kill(pid, 0);
          daemonRunning = true;
        } catch {
          daemonRunning = false;
        }
      }
      if (!pidFileExists) {
        console.log("Daemon process: not running (no pid file)");
      } else if (!daemonRunning) {
        console.log(`Daemon process: not running (stale pid ${pid})`);
      } else {
        console.log(`Daemon process: running (pid ${pid})`);
      }
      const socketPath = getSocketPath();
      console.log(`Socket: ${socketPath}${existsSync(socketPath) ? " (exists)" : " (not found)"}`);
    });

  // Reset data
  program
    .command("reset")
    .description("Reset all data (conversations, logs) without touching config files")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options) => {
      if (isDaemonRunning()) {
        console.error(
          "Marvis daemon is currently running. Please stop it first with: marvis stop",
        );
        process.exit(1);
      }

      const config = getConfig();
      const dataDir = config.paths.dataDir;
      const logDir = config.paths.logDir;
      const socketPath = config.paths.socketPath;

      if (!options.yes) {
        const readline = await import("node:readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(
            "This will delete all conversations, memories, and logs. Are you sure? [y/N] ",
            (ans) => {
              rl.close();
              resolve(ans.trim().toLowerCase());
            },
          );
        });

        if (answer !== "y" && answer !== "yes") {
          console.log("Reset cancelled.");
          return;
        }
      }

      const removed: string[] = [];

      // Remove database file
      const dbPath = getDbPath();
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
        removed.push(`Database: ${dbPath}`);
      }
      // Remove WAL and SHM files (SQLite journal artifacts)
      for (const suffix of ["-wal", "-shm"]) {
        const journalPath = dbPath + suffix;
        if (existsSync(journalPath)) {
          unlinkSync(journalPath);
          removed.push(`Database journal: ${journalPath}`);
        }
      }

      // Remove PID file
      const pidFile = getPidFile();
      if (existsSync(pidFile)) {
        unlinkSync(pidFile);
        removed.push(`PID file: ${pidFile}`);
      }

      // Remove socket file
      if (existsSync(socketPath)) {
        unlinkSync(socketPath);
        removed.push(`Socket: ${socketPath}`);
      }

      // Clear log files (remove all files in log directory, keep the directory)
      if (existsSync(logDir)) {
        const logFiles = readdirSync(logDir);
        for (const file of logFiles) {
          const filePath = join(logDir, file);
          rmSync(filePath, { recursive: true });
          removed.push(`Log: ${filePath}`);
        }
      }

      if (removed.length === 0) {
        console.log("Nothing to reset — no data files found.");
      } else {
        console.log("Marvis data has been reset:");
        for (const item of removed) {
          console.log(`  ✓ ${item}`);
        }
      }
    });

  // Trading subcommand
  program.addCommand(createTradingCommand());

  return program;
}

function isDaemonRunning(): boolean {
  const pidFile = getPidFile();
  if (!existsSync(pidFile)) return false;
  try {
    const pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForDaemon(timeout = 5000): Promise<void> {
  const socketPath = getSocketPath();
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (existsSync(socketPath)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Daemon failed to start");
}

function getDaemonConfig(): DaemonConfig {
  const config = getConfig();
  return {
    socketPath: getSocketPath(),
    pidFile: getPidFile(),
    logFile: getLogFile(),
    dbPath: getDbPath(),
    marvisConfig: config,
  };
}
