import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../../src/core/memory/store";
import * as fs from "fs";
import * as path from "path";

const TEST_DB_PATH = "data/test-marvis.db";

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    store = new MemoryStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe("conversations", () => {
    it("should create a new conversation", async () => {
      const id = await store.createConversation("Test Conversation");
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("should check if conversation exists", async () => {
      const id = await store.createConversation();
      expect(await store.conversationExists(id)).toBe(true);
      expect(await store.conversationExists("non-existent")).toBe(false);
    });

    it("should get last conversation id", async () => {
      expect(await store.getLastConversationId()).toBeNull();

      const id1 = await store.createConversation();
      expect(await store.getLastConversationId()).toBe(id1);

      const id2 = await store.createConversation();
      expect(await store.getLastConversationId()).toBe(id2);
    });

    it("should list conversations", async () => {
      await store.createConversation("First");
      await store.createConversation("Second");

      const conversations = await store.listConversations();
      expect(conversations.length).toBe(2);
      expect(conversations[0].title).toBe("Second"); // Most recent first
      expect(conversations[1].title).toBe("First");
    });

    it("should update conversation title", async () => {
      const id = await store.createConversation();
      expect((await store.listConversations())[0].title).toBeNull();

      await store.updateConversationTitle(id, "My Chat");
      const conversations = await store.listConversations();
      expect(conversations[0].title).toBe("My Chat");
    });
  });

  describe("messages", () => {
    it("should add and retrieve messages", async () => {
      const convId = await store.createConversation();

      const msgId = await store.addMessage(convId, {
        role: "user",
        content: "Hello, Marvis!",
      });
      expect(msgId).toBeDefined();

      const messages = await store.getMessages(convId);
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe("Hello, Marvis!");
      expect(messages[0].role).toBe("user");
    });

    it("should estimate tokens for messages", async () => {
      const convId = await store.createConversation();
      await store.addMessage(convId, {
        role: "user",
        content: "This is a test message with some content.",
      });

      const messages = await store.getMessages(convId);
      expect(messages[0].tokensEstimated).toBeGreaterThan(0);
    });

    it("should get total tokens for conversation", async () => {
      const convId = await store.createConversation();
      await store.addMessage(convId, { role: "user", content: "Hello" });
      await store.addMessage(convId, {
        role: "assistant",
        content: "Hi there!",
      });

      const totalTokens = await store.getTotalTokens(convId);
      expect(totalTokens).toBeGreaterThan(0);
    });
  });
});
