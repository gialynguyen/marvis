import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MarvisDaemon } from "../../src/daemon/daemon";
import { IPCClient } from "../../src/daemon/ipc-client";
import { DEFAULT_CONFIG } from "@marvis/config";
import * as fs from "fs";
const TEST_CONFIG = {
  socketPath: "data/test-daemon.sock",
  pidFile: "data/test-daemon.pid",
  logFile: "data/test-daemon.log",
  dbPath: "data/test-daemon.db",
  marvisConfig: DEFAULT_CONFIG,
};

describe("MarvisDaemon", () => {
  let daemon: MarvisDaemon;

  beforeEach(() => {
    // Clean up test files
    for (const file of [
      TEST_CONFIG.socketPath,
      TEST_CONFIG.pidFile,
      TEST_CONFIG.dbPath,
    ]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
    }
    // Clean up test files
    for (const file of [
      TEST_CONFIG.socketPath,
      TEST_CONFIG.pidFile,
      TEST_CONFIG.dbPath,
    ]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  it("should start and create PID file", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    expect(fs.existsSync(TEST_CONFIG.pidFile)).toBe(true);
    expect(fs.existsSync(TEST_CONFIG.socketPath)).toBe(true);
  });

  it("should respond to status request", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    const client = new IPCClient(TEST_CONFIG.socketPath);
    const response = await client.send({ type: "status" });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("uptime");
    expect(response.data).toHaveProperty("pid");
  });

  it("should clean up on shutdown", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();
    await daemon.shutdown();

    expect(fs.existsSync(TEST_CONFIG.pidFile)).toBe(false);
    expect(fs.existsSync(TEST_CONFIG.socketPath)).toBe(false);
  });

  it("should return error response when handlePrompt throws", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    const d = daemon as any;

    d.marvisAgent = {
      prompt: async () => {
        throw new Error("LLM unavailable");
      },
    };

    const chunks: any[] = [];
    const sendChunk = (chunk: any) => chunks.push(chunk);

    const response = await d.handleRequest(
      { id: "test-1", type: "prompt", data: { message: "hello" } },
      sendChunk,
    );

    expect(response.success).toBe(false);
    expect(response.error).toContain("LLM unavailable");
  });

  it("should return conversation history", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    const client = new IPCClient(TEST_CONFIG.socketPath);

    const historyResponse = await client.send({ type: "history" });
    expect(historyResponse.success).toBe(true);
    expect(Array.isArray(historyResponse.data)).toBe(true);
  });

  it("should list conversations", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    const client = new IPCClient(TEST_CONFIG.socketPath);

    // Create a second conversation
    await client.send({ type: "new_conversation" });

    const response = await client.send({ type: "list_conversations" });
    expect(response.success).toBe(true);
    const conversations = response.data as Array<{ id: string; title: string | null }>;
    expect(conversations.length).toBe(2);
  });

  it("should switch to an existing conversation", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    const client = new IPCClient(TEST_CONFIG.socketPath);

    // Get current conversation
    const statusBefore = await client.send({ type: "status" });
    const firstConvId = (statusBefore.data as any).conversationId;

    // Create new conversation
    const newConvResponse = await client.send({ type: "new_conversation" });
    const newConvId = (newConvResponse.data as any).conversationId;

    // Switch back to first
    const switchResponse = await client.send({
      type: "switch_conversation",
      data: { conversationId: firstConvId },
    });
    expect(switchResponse.success).toBe(true);

    // Verify we switched
    const statusAfter = await client.send({ type: "status" });
    expect((statusAfter.data as any).conversationId).toBe(firstConvId);
  });

  it("should fail to switch to non-existent conversation", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    const client = new IPCClient(TEST_CONFIG.socketPath);
    const response = await client.send({
      type: "switch_conversation",
      data: { conversationId: "non-existent-id" },
    });
    expect(response.success).toBe(false);
    expect(response.error).toContain("not found");
  });

  it("should auto-title conversation from first user message", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    const client = new IPCClient(TEST_CONFIG.socketPath);

    // Start fresh conversation
    await client.send({ type: "new_conversation" });

    // Verify no title initially
    const beforeResponse = await client.send({ type: "list_conversations" });
    const conversations = beforeResponse.data as any[];
    const newConv = conversations[0];
    expect(newConv.title).toBeNull();

    // Mock marvisAgent.prompt to avoid LLM call
    const d = daemon as any;
    d.marvisAgent.prompt = async (msg: string, cb: any) => {
      await d.memoryStore.addMessage(d.currentConversationId, {
        role: "user",
        content: msg,
      });
      await d.memoryStore.addMessage(d.currentConversationId, {
        role: "assistant",
        content: "Hello!",
      });
      return "Hello!";
    };

    // Call handlePrompt directly (handleRequest) via IPC
    const chunks: string[] = [];
    for await (const chunk of client.sendStreaming({
      type: "prompt",
      data: { message: "What is the weather in Tokyo?" },
    })) {
      chunks.push(chunk);
    }

    // Verify title was set
    const afterResponse = await client.send({ type: "list_conversations" });
    const afterConversations = afterResponse.data as any[];
    const updatedConv = afterConversations.find((c: any) => c.id === newConv.id);
    expect(updatedConv.title).toBe("What is the weather in Tokyo?");
  });

  it("should support full conversation lifecycle: create, list, switch, history", async () => {
    daemon = new MarvisDaemon(TEST_CONFIG);
    await daemon.start();

    const client = new IPCClient(TEST_CONFIG.socketPath);

    // Get initial conversation
    const status1 = await client.send({ type: "status" });
    const conv1Id = (status1.data as any).conversationId;
    expect(conv1Id).toBeDefined();

    // Create second conversation
    const newConvRes = await client.send({ type: "new_conversation" });
    const conv2Id = (newConvRes.data as any).conversationId;
    expect(conv2Id).not.toBe(conv1Id);

    // List should show 2 conversations
    const listRes = await client.send({ type: "list_conversations" });
    expect((listRes.data as any[]).length).toBe(2);

    // Switch back to first
    const switchRes = await client.send({
      type: "switch_conversation",
      data: { conversationId: conv1Id },
    });
    expect(switchRes.success).toBe(true);

    // Verify status shows first conversation
    const status2 = await client.send({ type: "status" });
    expect((status2.data as any).conversationId).toBe(conv1Id);

    // History should be empty for first conversation (no messages sent)
    const historyRes = await client.send({ type: "history" });
    expect(historyRes.success).toBe(true);
    expect((historyRes.data as any[]).length).toBe(0);
  });
});
