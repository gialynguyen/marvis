import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ContextManager } from "../../../src/core/memory/context.js";
import { MemoryStore } from "../../../src/core/memory/store.js";
import * as fs from "fs";

const TEST_DB_PATH = "data/test-context.db";

describe("ContextManager", () => {
  let store: MemoryStore;
  let contextManager: ContextManager;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    store = new MemoryStore(TEST_DB_PATH);
    contextManager = new ContextManager(500, 400);
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("should build context from conversation messages", async () => {
    const convId = await store.createConversation();
    await store.addMessage(convId, { role: "user", content: "Hello" });
    await store.addMessage(convId, { role: "assistant", content: "Hi there!" });

    const context = await contextManager.buildContext(convId, store);
    expect(context.length).toBe(2);
    expect(context[0].role).toBe("user");
    expect(context[1].role).toBe("assistant");
  });

  it("should respect token limits by keeping recent messages", async () => {
    const convId = await store.createConversation();
    
    // Add many messages to exceed token limit
    for (let i = 0; i < 20; i++) {
      await store.addMessage(convId, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message number ${i} with some extra content to use tokens.`,
      });
    }

    const context = await contextManager.buildContext(convId, store);
    
    // Should have fewer messages than we added due to token limits
    expect(context.length).toBeLessThan(20);
    // Last message should be the most recent
    expect(context[context.length - 1].content).toContain("Message number 19");
  });
});
