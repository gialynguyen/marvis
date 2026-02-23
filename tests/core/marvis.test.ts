import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Pi framework modules
vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn(),
    replaceMessages: vi.fn(),
    setModel: vi.fn(),
    state: { messages: [] },
  })),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(() => ({ id: "test-model" })),
}));

import { MarvisAgent } from "../../src/core/marvis.js";
import type { PluginManager } from "../../src/plugins/manager.js";
import type { MemoryStore } from "../../src/core/memory/store.js";

describe("MarvisAgent", () => {
  let mockPluginManager: PluginManager;
  let mockMemoryStore: MemoryStore;

  beforeEach(() => {
    mockPluginManager = {
      getAllTools: vi.fn(() => []),
    } as unknown as PluginManager;

    mockMemoryStore = {
      addMessage: vi.fn(),
      getMessages: vi.fn(() => []),
    } as unknown as MemoryStore;
  });

  it("should create agent with config", () => {
    const agent = new MarvisAgent(
      {
        provider: "anthropic",
        model: "claude-sonnet-4-0",
        systemPrompt: "Test prompt",
        confirmDangerousTools: true,
        dangerThreshold: "dangerous",
      },
      mockPluginManager,
      mockMemoryStore,
      "conv-123"
    );

    expect(agent).toBeDefined();
  });

  it("should prompt and persist messages", async () => {
    const agent = new MarvisAgent(
      {
        provider: "anthropic",
        model: "claude-sonnet-4-0",
        systemPrompt: "Test prompt",
        confirmDangerousTools: true,
        dangerThreshold: "dangerous",
      },
      mockPluginManager,
      mockMemoryStore,
      "conv-123"
    );

    await agent.prompt("Hello");

    expect(mockMemoryStore.addMessage).toHaveBeenCalledWith(
      "conv-123",
      { role: "user", content: "Hello" }
    );

  });
});
