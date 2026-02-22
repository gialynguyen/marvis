#!/usr/bin/env node
import { MarvisDaemon } from "../daemon/daemon.js";

const daemon = new MarvisDaemon({
  socketPath: "data/marvis.sock",
  pidFile: "data/marvis.pid",
  logFile: "data/marvis.log",
  dbPath: "data/marvis.db",
  marvisConfig: {},
});

daemon.start().catch((err) => {
  console.error("Failed to start daemon:", err);
  process.exit(1);
});
