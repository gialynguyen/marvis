import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import type { DaemonConfig, IPCRequest, IPCResponse, DaemonStatus, IPCStreamChunk } from "../types/index.js";
import { IPCServer } from "./ipc-server.js";
import { createLogger, type Logger } from "./logger.js";
import { MemoryStore } from "../core/memory/store.js";
import { PluginManager } from "../plugins/manager.js";
import { ShellPlugin } from "../plugins/shell/index.js";
import { MarvisAgent } from "../core/marvis.js";
import { loadConfig } from "../core/config.js";


export class MarvisDaemon {
  private ipcServer!: IPCServer;
  private logger: Logger;
  private config: DaemonConfig;
  private isShuttingDown = false;
  private memoryStore!: MemoryStore;
  private pluginManager!: PluginManager;
  private currentConversationId: string | null = null;
  private startTime: number = 0;
  private marvisAgent!: MarvisAgent;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.logger = createLogger("daemon", config.logFile);
  }

  async start(): Promise<void> {
    if (this.isAlreadyRunning()) {
      throw new Error("Marvis daemon is already running");
    }

    this.logger.info("Starting Marvis daemon...");
    this.startTime = Date.now();

    this.writePidFile();

    this.memoryStore = new MemoryStore(this.config.dbPath);
    this.logger.info("Memory store initialized");

    this.pluginManager = new PluginManager();

    await this.loadBuiltinPlugins();

    this.currentConversationId = await this.memoryStore.getLastConversationId();
    if (!this.currentConversationId) {
      this.currentConversationId = await this.memoryStore.createConversation();
    }
    this.logger.info(`Active conversation: ${this.currentConversationId}`);

    const config = loadConfig();
    this.marvisAgent = new MarvisAgent(
      {
        provider: config.llm.provider,
        model: config.llm.model,
        systemPrompt: config.system.systemPrompt,
        confirmDangerousTools: config.tools.confirmDangerous,
        dangerThreshold: config.tools.dangerThreshold,
      },
      this.pluginManager,
      this.memoryStore,
      this.currentConversationId!
    );
    this.logger.info("MarvisAgent initialized");

    this.ipcServer = new IPCServer(
      this.config.socketPath,
      this.handleRequest.bind(this)
    );
    await this.ipcServer.start();
    this.logger.info(`IPC server listening on ${this.config.socketPath}`);

    this.setupSignalHandlers();

    this.logger.info("Marvis daemon started successfully");
  }

  private async loadBuiltinPlugins(): Promise<void> {
    const shellPlugin = new ShellPlugin();
    await this.pluginManager.loadPlugin(shellPlugin);
  }

  private isAlreadyRunning(): boolean {
    if (!existsSync(this.config.pidFile)) return false;

    try {
      const pid = parseInt(readFileSync(this.config.pidFile, "utf-8").trim());
      process.kill(pid, 0);
      return true;
    } catch {
      unlinkSync(this.config.pidFile);
      return false;
    }
  }

  private writePidFile(): void {
    writeFileSync(this.config.pidFile, process.pid.toString());
  }

  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      this.logger.info(`Received ${signal}, shutting down...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGHUP", () => shutdown("SIGHUP"));
  }

  private async handleRequest(request: IPCRequest, sendChunk?: (chunk: IPCStreamChunk) => void): Promise<IPCResponse> {
    try {
      switch (request.type) {
        case "status":
          return this.handleStatus();
        case "plugins":
          return this.handlePlugins();
        case "new_conversation":
          return await this.handleNewConversation();
        case "prompt":
          return this.handlePrompt(request, sendChunk);
        case "set_model":
          return this.handleSetModel(request);
        case "shutdown":
          setTimeout(() => this.shutdown(), 100);
          return { success: true, data: "Shutdown initiated" };
        default:
          return {
            success: false,
            error: `Unknown request type: ${request.type}`,
          };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Request handling error", { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private handleStatus(): IPCResponse {
    const status: DaemonStatus = {
      uptime: (Date.now() - this.startTime) / 1000,
      memoryUsage: process.memoryUsage(),
      pid: process.pid,
      conversationId: this.currentConversationId,
      pluginCount: this.pluginManager.listPlugins().length,
      activeAgents: Array.from(this.pluginManager.getActiveAgents().keys()),
    };

    return {
      success: true,
      data: status,
    };
  }

  private handlePlugins(): IPCResponse {
    return {
      success: true,
      data: this.pluginManager.listPlugins(),
    };
  }

  private async handleNewConversation(): Promise<IPCResponse> {
    this.currentConversationId = await this.memoryStore.createConversation();
    return {
      success: true,
      data: { conversationId: this.currentConversationId },
    };
  }


  private async handlePrompt(
    request: IPCRequest,
    sendChunk?: (chunk: IPCStreamChunk) => void
  ): Promise<IPCResponse> {
    const { message } = request.data as { message: string };

    await this.marvisAgent.prompt(message, (chunk) => {
      sendChunk?.({ id: request.id, type: "text", chunk });
    });

    sendChunk?.({ id: request.id, type: "done" });
    return { id: request.id, success: true };
  }

  private handleSetModel(request: IPCRequest): IPCResponse {
    const { provider, model } = request.data as { provider: string; model: string };
    this.marvisAgent.setModel(provider, model);
    return { id: request.id, success: true };
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.logger.info("Shutting down Marvis daemon...");
    if (this.ipcServer) {
      await this.ipcServer.stop();
    }
    if (this.pluginManager) {
      await this.pluginManager.shutdownAll();
    }
    if (this.memoryStore) {
      this.memoryStore.close();
    }
    if (existsSync(this.config.pidFile)) {
      unlinkSync(this.config.pidFile);
    }
    this.logger.info("Marvis daemon shut down successfully");
    this.logger.close();
  }
}
