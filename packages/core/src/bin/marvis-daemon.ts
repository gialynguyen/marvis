#!/usr/bin/env node
import { join } from "node:path";
import { MarvisDaemon } from "../daemon/daemon";
import {
  loadConfig,
  ensureConfigExists,
  ensureDirectoriesExist,
  PluginConfigRegistry,
} from "@marvis/config";

// Ensure config exists on first run
ensureConfigExists();

// Create registry (plugins will be registered externally when available)
const registry = new PluginConfigRegistry();

const config = loadConfig(undefined, registry);
ensureDirectoriesExist({
  dataDir: config.paths.dataDir,
  logDir: config.paths.logDir,
});

const daemon = new MarvisDaemon({
  socketPath: config.paths.socketPath,
  pidFile: join(config.paths.dataDir, "marvis.pid"),
  logFile: config.logging.file || join(config.paths.logDir, "marvis.log"),
  dbPath: join(config.paths.dataDir, "marvis.db"),
  marvisConfig: config,
});

// Enable hot-reload
daemon.setLoadConfigFn(() => loadConfig(undefined, registry));

daemon.start().catch((err) => {
  console.error("Failed to start daemon:", err);
  process.exit(1);
});
