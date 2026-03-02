import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { MarvisAgent } from "../core/marvis";
import { MemoryStore } from "../core/memory/store";
import { PluginManager } from "../plugins/manager";
import type { DaemonConfig, DaemonStatus, IPCRequest, IPCResponse, IPCStreamChunk } from "../types";
import type { Plugin } from "../plugins/plugin";
import { IPCServer } from "./ipc-server";
import { createLogger, type Logger } from "./logger";
import { ConfigReloadManager } from "./config-reload-manager";
import { ConfigWatcher } from "@marvis/config";

export class MarvisDaemon {
  private ipcServer!: IPCServer;
  private logger: Logger;
  private config: DaemonConfig;
  private isShuttingDown = false;
  private memoryStore!: MemoryStore;
  private pluginManager: PluginManager;
  private currentConversationId: string | null = null;
  private startTime = 0;
  private marvisAgent!: MarvisAgent;
  private pendingPlugins: Array<{ plugin: Plugin; config: Record<string, unknown> }> = [];
  private configWatcher: ConfigWatcher | null = null;
  private reloadManager: ConfigReloadManager | null = null;
  private loadConfigFn?: () => import("@marvis/config").MarvisConfig;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.logger = createLogger("daemon", config.logFile);
    this.pluginManager = new PluginManager();
  }

  /**
   * Register a plugin to be loaded when the daemon starts.
   * Must be called before `start()`.
   */
  registerPlugin(plugin: Plugin, config: Record<string, unknown> = {}): void {
    this.pendingPlugins.push({ plugin, config });
  }

  /**
   * Set a function that reloads MarvisConfig from disk.
   * Required for hot-reload support. Must be called before `start()`.
   */
  setLoadConfigFn(fn: () => import("@marvis/config").MarvisConfig): void {
    this.loadConfigFn = fn;
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

    await this.loadBuiltinPlugins();

    this.currentConversationId = await this.memoryStore.getLastConversationId();
    if (!this.currentConversationId) {
      this.currentConversationId = await this.memoryStore.createConversation();
    }
    this.logger.info(`Active conversation: ${this.currentConversationId}`);

    const marvisConfig = this.config.marvisConfig;
    this.marvisAgent = new MarvisAgent(
      {
        provider: marvisConfig.llm.provider,
        model: marvisConfig.llm.model,
        systemPrompt: marvisConfig.system.systemPrompt,
        confirmDangerousTools: marvisConfig.tools.confirmDangerous,
        dangerThreshold: marvisConfig.tools.dangerThreshold,
        apiKey: marvisConfig.llm.apiKey,
      },
      this.pluginManager,
      this.memoryStore,
      this.currentConversationId!,
    );
    this.logger.info("MarvisAgent initialized");

    this.ipcServer = new IPCServer(this.config.socketPath, this.handleRequest.bind(this));
    await this.ipcServer.start();
    this.logger.info(`IPC server listening on ${this.config.socketPath}`);

    // Set up hot-reload: config watcher + reload manager
    if (this.loadConfigFn) {
      this.reloadManager = new ConfigReloadManager(
        this.loadConfigFn,
        () => this.config.marvisConfig,
        (newConfig) => { this.config.marvisConfig = newConfig; },
        this.pluginManager,
        this.marvisAgent,
        this.logger,
      );

      this.configWatcher = new ConfigWatcher();
      this.configWatcher.start(() => {
        this.reloadManager?.reload().catch((err) => {
          this.logger.error("Config reload failed", { error: String(err) });
        });
      });
      this.logger.info("Config hot-reload enabled");
    }

    this.setupSignalHandlers();

    this.logger.info("Marvis daemon started successfully");
  }

  private async loadBuiltinPlugins(): Promise<void> {
    // Load externally registered plugins based on load_on_startup config
    for (const { plugin, config } of this.pendingPlugins) {
      const pluginId = plugin.manifest.id;
      const pluginConfig = {
        ...config,
        ...this.config.marvisConfig.plugins[pluginId],
      };

      // Check load_on_startup from the merged plugin config (default: false)
      const loadOnStartup = pluginConfig.load_on_startup ?? false;

      // Remove load_on_startup from the config passed to the plugin itself
      // (it's a daemon-level concern, not a plugin config field)
      const { load_on_startup: _, ...pluginInitConfig } = pluginConfig;

      if (loadOnStartup) {
        await this.pluginManager.loadPlugin(plugin, pluginInitConfig);
      } else {
        this.pluginManager.registerAvailable(plugin, pluginInitConfig);
      }
    }
    this.pendingPlugins = [];
  }

  private isAlreadyRunning(): boolean {
    if (!existsSync(this.config.pidFile)) return false;

    try {
      const pid = Number.parseInt(readFileSync(this.config.pidFile, "utf-8").trim());
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

  private async handleRequest(
    request: IPCRequest,
    sendChunk?: (chunk: IPCStreamChunk) => void,
  ): Promise<IPCResponse> {
    try {
      switch (request.type) {
        case "status":
          return this.handleStatus();
        case "plugins":
          return this.handlePlugins();
        case "new_conversation":
          return await this.handleNewConversation();
        case "prompt":
          return await this.handlePrompt(request, sendChunk);
        case "set_model":
          return this.handleSetModel(request);
        case "shutdown":
          setTimeout(() => this.shutdown(), 100);
          return { success: true, data: "Shutdown initiated" };
        case "reload_config":
          return await this.handleReloadConfig();
        case "history":
          return await this.handleHistory();
        case "list_conversations":
          return await this.handleListConversations();
        case "switch_conversation":
          return await this.handleSwitchConversation(request);
        default:
          return {
            success: false,
            error: `Unknown request type: ${request.type}`,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
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
      data: this.pluginManager.getAllPlugins(),
    };
  }

  private async handleNewConversation(): Promise<IPCResponse> {
    this.currentConversationId = await this.memoryStore.createConversation();
    return {
      success: true,
      data: { conversationId: this.currentConversationId },
    };
  }

  private async handleHistory(): Promise<IPCResponse> {
    if (!this.currentConversationId) {
      return { success: true, data: [] };
    }
    const messages = await this.memoryStore.getMessages(this.currentConversationId);
    return { success: true, data: messages };
  }

  private async handleListConversations(): Promise<IPCResponse> {
    const conversations = await this.memoryStore.listConversations();
    return { success: true, data: conversations };
  }

  private async handleSwitchConversation(request: IPCRequest): Promise<IPCResponse> {
    const { conversationId } = request.data as { conversationId: string };

    const exists = await this.memoryStore.conversationExists(conversationId);
    if (!exists) {
      return { success: false, error: `Conversation ${conversationId} not found` };
    }

    this.currentConversationId = conversationId;
    await this.marvisAgent.loadConversation(conversationId);
    return { success: true, data: { conversationId } };
  }

  private async handlePrompt(
    request: IPCRequest,
    sendChunk?: (chunk: IPCStreamChunk) => void,
  ): Promise<IPCResponse> {
    const { message } = request.data as { message: string };

    await this.marvisAgent.prompt(message, (chunk) => {
      sendChunk?.({ id: request.id, type: "text", chunk });
    });

    await this.autoTitleConversation(message);

    sendChunk?.({ id: request.id, type: "done" });
    return { id: request.id, success: true };
  }

  private handleSetModel(request: IPCRequest): IPCResponse {
    const { provider, model } = request.data as {
      provider: string;
      model: string;
    };
    this.marvisAgent.setModel(provider, model);
    return { id: request.id, success: true };
  }

  private async handleReloadConfig(): Promise<IPCResponse> {
    if (!this.reloadManager) {
      return {
        success: false,
        error: "Config hot-reload is not enabled (no loadConfigFn set)",
      };
    }

    const result = await this.reloadManager.reload();
    return {
      success: result.errors.length === 0,
      data: result,
    };
  }

  /** Get the reload manager for external use (e.g., ConfigPlugin) */
  getReloadManager(): ConfigReloadManager | null {
    return this.reloadManager;
  }

  /** Get the plugin manager for external use (e.g., PluginManagerPlugin) */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  /** Get the MarvisAgent for external use (e.g., tool refresh after plugin load/unload) */
  getMarvisAgent(): MarvisAgent {
    return this.marvisAgent;
  }

  private async autoTitleConversation(firstMessage: string): Promise<void> {
    if (!this.currentConversationId) return;

    const conversations = await this.memoryStore.listConversations();
    const current = conversations.find((c) => c.id === this.currentConversationId);
    if (current && current.title === null) {
      const title = firstMessage.length > 80 ? `${firstMessage.slice(0, 77)}...` : firstMessage;
      await this.memoryStore.updateConversationTitle(this.currentConversationId, title);
    }
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.logger.info("Shutting down Marvis daemon...");
    if (this.configWatcher) {
      this.configWatcher.stop();
      this.configWatcher = null;
    }
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
