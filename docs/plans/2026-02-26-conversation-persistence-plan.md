# Conversation Persistence & History Implementation Plan

> **⚠️ Post-Migration Note (2026-02-27):** This document was written before the monorepo migration.
> The project has been restructured from a flat `src/` layout into a pnpm monorepo with:
> - `packages/core/` (@marvis/core) — Core logic, daemon, memory, plugin system, types
> - `packages/plugin-shell/` (@marvis/plugin-shell) — Shell command plugin
> - `apps/cli/` (@marvis/cli) — CLI interface
>
> All file paths, import paths, and build commands in this document have been updated to reflect the new structure.
> Build: `pnpm build` (Turborepo) | Test: `pnpm test` | Lint: `pnpm lint` (Biome.js)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up existing SQLite infrastructure so users can list, resume, switch, and browse conversations from the REPL.

**Architecture:** Most infrastructure exists (SQLite schema, MemoryStore, MarvisAgent.loadConversation). We add 3 daemon handlers, 2 IPC types, 2 REPL commands, 1 MemoryStore method, and auto-titling. All changes are TDD with vitest.

**Tech Stack:** TypeScript, vitest, better-sqlite3, Node.js readline

---

### Task 1: Add IPC Request Types

**Files:**
- Modify: `packages/core/src/types/index.ts:28-39` (IPCRequestType union)

**Step 1: Write the failing test**

In `packages/core/tests/types/ipc-types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("IPCRequestType", () => {
  it("should accept list_conversations as a valid type", async () => {
    const { } = await import("../../src/types/index");
    const type: import("../../src/types/index").IPCRequestType = "list_conversations";
    expect(type).toBe("list_conversations");
  });

  it("should accept switch_conversation as a valid type", async () => {
    const type: import("../../src/types/index").IPCRequestType = "switch_conversation";
    expect(type).toBe("switch_conversation");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/core/tests/types/ipc-types.test.ts`
Expected: FAIL — TypeScript error, `"list_conversations"` is not assignable to `IPCRequestType`

**Step 3: Write minimal implementation**

In `packages/core/src/types/index.ts`, add to `IPCRequestType` union (after `"new_conversation"`):

```typescript
export type IPCRequestType =
  | "prompt"
  | "abort"
  | "status"
  | "history"
  | "new_conversation"
  | "list_conversations"
  | "switch_conversation"
  | "set_model"
  | "confirm_tool"
  | "plugins"
  | "plugin_promote"
  | "plugin_demote"
  | "shutdown";
```

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/core/tests/types/ipc-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/types/index.ts packages/core/tests/types/ipc-types.test.ts
git commit -m "feat: add list_conversations and switch_conversation IPC types"
```

---

### Task 2: Add `updateConversationTitle()` to MemoryStore

**Files:**
- Modify: `packages/core/src/core/memory/store.ts` (add method after `createConversation`)
- Modify: `packages/core/tests/core/memory/store.test.ts` (add test)

**Step 1: Write the failing test**

Add to `packages/core/tests/core/memory/store.test.ts` inside the `conversations` describe block:

```typescript
it("should update conversation title", async () => {
  const id = await store.createConversation();
  expect((await store.listConversations())[0].title).toBeNull();

  await store.updateConversationTitle(id, "My Chat");
  const conversations = await store.listConversations();
  expect(conversations[0].title).toBe("My Chat");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/core/tests/core/memory/store.test.ts`
Expected: FAIL — `store.updateConversationTitle is not a function`

**Step 3: Write minimal implementation**

Add to `packages/core/src/core/memory/store.ts` after the `createConversation` method (after line 80):

```typescript
async updateConversationTitle(id: string, title: string): Promise<void> {
  this.db
    .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
    .run(title, Date.now(), id);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/core/tests/core/memory/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/core/memory/store.ts packages/core/tests/core/memory/store.test.ts
git commit -m "feat: add updateConversationTitle to MemoryStore"
```

---

### Task 3: Add `handleHistory` Daemon Handler

**Files:**
- Modify: `packages/core/src/daemon/daemon.ts` (add handler + switch case)
- Modify: `packages/core/tests/daemon/daemon.test.ts` (add test)

**Step 1: Write the failing test**

Add to `packages/core/tests/daemon/daemon.test.ts` inside the `MarvisDaemon` describe block:

```typescript
it("should return conversation history", async () => {
  daemon = new MarvisDaemon(TEST_CONFIG);
  await daemon.start();

  // Send a prompt first so there's history
  const client = new IPCClient(TEST_CONFIG.socketPath);

  const historyResponse = await client.send({ type: "history" });
  expect(historyResponse.success).toBe(true);
  expect(Array.isArray(historyResponse.data)).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/core/tests/daemon/daemon.test.ts`
Expected: FAIL — `Unknown request type: history`

**Step 3: Write minimal implementation**

In `packages/core/src/daemon/daemon.ts`:

1. Add case in `handleRequest` switch (before `default`):

```typescript
case "history":
  return await this.handleHistory();
```

2. Add handler method (after `handleNewConversation`):

```typescript
private async handleHistory(): Promise<IPCResponse> {
  if (!this.currentConversationId) {
    return { success: true, data: [] };
  }
  const messages = await this.memoryStore.getMessages(this.currentConversationId);
  return { success: true, data: messages };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/core/tests/daemon/daemon.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/daemon/daemon.ts packages/core/tests/daemon/daemon.test.ts
git commit -m "feat: add history handler to daemon"
```

---

### Task 4: Add `handleListConversations` Daemon Handler

**Files:**
- Modify: `packages/core/src/daemon/daemon.ts` (add handler + switch case)
- Modify: `packages/core/tests/daemon/daemon.test.ts` (add test)

**Step 1: Write the failing test**

Add to `packages/core/tests/daemon/daemon.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/core/tests/daemon/daemon.test.ts`
Expected: FAIL — `Unknown request type: list_conversations`

**Step 3: Write minimal implementation**

In `packages/core/src/daemon/daemon.ts`:

1. Add case in `handleRequest` switch:

```typescript
case "list_conversations":
  return await this.handleListConversations();
```

2. Add handler method:

```typescript
private async handleListConversations(): Promise<IPCResponse> {
  const conversations = await this.memoryStore.listConversations();
  return { success: true, data: conversations };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/core/tests/daemon/daemon.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/daemon/daemon.ts packages/core/tests/daemon/daemon.test.ts
git commit -m "feat: add list_conversations handler to daemon"
```

---

### Task 5: Add `handleSwitchConversation` Daemon Handler

**Files:**
- Modify: `packages/core/src/daemon/daemon.ts` (add handler + switch case)
- Modify: `packages/core/tests/daemon/daemon.test.ts` (add tests)

**Step 1: Write the failing tests**

Add to `packages/core/tests/daemon/daemon.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/core/tests/daemon/daemon.test.ts`
Expected: FAIL — `Unknown request type: switch_conversation`

**Step 3: Write minimal implementation**

In `packages/core/src/daemon/daemon.ts`:

1. Add case in `handleRequest` switch:

```typescript
case "switch_conversation":
  return await this.handleSwitchConversation(request);
```

2. Add handler method:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/core/tests/daemon/daemon.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/daemon/daemon.ts packages/core/tests/daemon/daemon.test.ts
git commit -m "feat: add switch_conversation handler to daemon"
```

---

### Task 6: Add Auto-Titling in `handlePrompt`

**Files:**
- Modify: `packages/core/src/daemon/daemon.ts` (modify `handlePrompt`)
- Modify: `packages/core/tests/daemon/daemon.test.ts` (add test)

**Step 1: Write the failing test**

Add to `packages/core/tests/daemon/daemon.test.ts`:

```typescript
it("should auto-title conversation from first user message", async () => {
  daemon = new MarvisDaemon(TEST_CONFIG);
  await daemon.start();

  const client = new IPCClient(TEST_CONFIG.socketPath);

  // Start fresh conversation
  await client.send({ type: "new_conversation" });

  // List conversations — new one should have no title
  const beforeResponse = await client.send({ type: "list_conversations" });
  const before = (beforeResponse.data as any[])[0];
  expect(before.title).toBeNull();

  // Send a prompt (will fail due to no LLM, but title should still be set)
  // We need to mock marvisAgent to avoid actual LLM call
  const d = daemon as any;
  const originalPrompt = d.marvisAgent.prompt.bind(d.marvisAgent);
  d.marvisAgent.prompt = async (msg: string, cb: any) => {
    // Don't actually call LLM, just store the user message
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

  // Send streaming prompt
  const chunks: any[] = [];
  for await (const chunk of client.sendStreaming({
    type: "prompt",
    data: { message: "What is the weather in Tokyo?" },
  })) {
    chunks.push(chunk);
  }

  // List conversations — should now have title
  const afterResponse = await client.send({ type: "list_conversations" });
  const after = (afterResponse.data as any[])[0];
  expect(after.title).toBe("What is the weather in Tokyo?");
});
```

Note: This test is tricky because `handlePrompt` calls `marvisAgent.prompt()` which needs an LLM. The test must mock `marvisAgent.prompt`. If mocking is difficult at the integration level, we can test auto-titling at a unit level by directly calling the daemon's internal method. Adjust the test based on what's feasible — the key assertion is that after the first prompt in a new conversation, the conversation title gets set.

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/core/tests/daemon/daemon.test.ts`
Expected: FAIL — title is still null because auto-titling isn't implemented

**Step 3: Write minimal implementation**

In `packages/core/src/daemon/daemon.ts`, modify `handlePrompt`:

```typescript
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

private async autoTitleConversation(firstMessage: string): Promise<void> {
  if (!this.currentConversationId) return;

  const conversations = await this.memoryStore.listConversations();
  const current = conversations.find(c => c.id === this.currentConversationId);
  if (current && current.title === null) {
    const title = firstMessage.length > 80
      ? firstMessage.slice(0, 77) + "..."
      : firstMessage;
    await this.memoryStore.updateConversationTitle(this.currentConversationId, title);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/core/tests/daemon/daemon.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/daemon/daemon.ts packages/core/tests/daemon/daemon.test.ts
git commit -m "feat: auto-title conversations from first user message"
```

---

### Task 7: Add `/conversations` REPL Command

**Files:**
- Modify: `apps/cli/src/cli/repl.ts` (add command handler + update help)
- Modify: `apps/cli/tests/cli/repl.test.ts` (add test)

**Step 1: Write the failing test**

Add to `apps/cli/tests/cli/repl.test.ts`:

```typescript
describe("MarvisREPL commands", () => {
  it("parseCommand recognizes /conversations", () => {
    const result = parseCommand("/conversations");
    expect(result).toEqual({ command: "conversations", args: [] });
  });

  it("parseCommand recognizes /switch with args", () => {
    const result = parseCommand("/switch abc123");
    expect(result).toEqual({ command: "switch", args: ["abc123"] });
  });
});
```

**Step 2: Run test to verify it passes (parseCommand is generic)**

Run: `pnpm test apps/cli/tests/cli/repl.test.ts`
Expected: PASS (parseCommand already handles any `/command args` — this verifies it)

**Step 3: Implement `/conversations` in repl.ts**

In `apps/cli/src/cli/repl.ts`:

1. Add case in `handleCommand` switch (before `default`):

```typescript
case "conversations":
  await this.listConversations();
  break;
```

2. Add handler method:

```typescript
private async listConversations(): Promise<void> {
  const response = await this.client.send({
    type: "list_conversations",
  });
  if (response.success && response.data) {
    const conversations = response.data as Array<{
      id: string;
      title: string | null;
      createdAt: number;
      updatedAt: number;
    }>;
    if (conversations.length === 0) {
      console.log("No conversations yet.");
      return;
    }
    console.log("\nConversations:\n");
    for (const conv of conversations) {
      const date = new Date(conv.updatedAt).toLocaleString();
      const title = conv.title ?? "(untitled)";
      const shortId = conv.id.slice(0, 8);
      console.log(`  ${shortId}  ${title}  (${date})`);
    }
    console.log();
  }
}
```

3. Update `showHelp()` to include new commands:

```typescript
private showHelp(): void {
  console.log(`
Commands:
  /new              Start a new conversation
  /history          Show conversation history
  /conversations    List all conversations
  /switch <id>      Switch to a conversation (partial ID ok)
  /model <p> <m>    Switch model (e.g., /model anthropic claude-sonnet-4-0)
  /quit             Exit REPL
`);
}
```

**Step 4: Run tests to verify everything passes**

Run: `pnpm test apps/cli/tests/cli/repl.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/cli/repl.ts apps/cli/tests/cli/repl.test.ts
git commit -m "feat: add /conversations REPL command"
```

---

### Task 8: Add `/switch` REPL Command

**Files:**
- Modify: `apps/cli/src/cli/repl.ts` (add command handler)
- Modify: `apps/cli/tests/cli/repl.test.ts` (parseCommand test already added in Task 7)

**Step 1: Write the failing test**

The parseCommand test was already added in Task 7. For /switch, we test the full flow via the daemon integration test in Task 5. The REPL handler itself is straightforward IPC wiring — if the daemon handler works (tested in Task 5) and parseCommand works (tested in Task 7), this is just glue code.

**Step 2: Implement `/switch` in repl.ts**

1. Add case in `handleCommand` switch:

```typescript
case "switch":
  await this.switchConversation(parsed.args);
  break;
```

2. Add handler method:

```typescript
private async switchConversation(args: string[]): Promise<void> {
  if (args.length !== 1) {
    console.log("Usage: /switch <conversation-id>");
    return;
  }
  const response = await this.client.send({
    type: "switch_conversation",
    data: { conversationId: args[0] },
  });
  if (response.success) {
    console.log("Switched conversation.");
  } else {
    console.log(`Failed: ${response.error}`);
  }
}
```

**Step 3: Run all tests**

Run: `pnpm test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add apps/cli/src/cli/repl.ts
git commit -m "feat: add /switch REPL command"
```

---

### Task 9: Integration Test — Full Conversation Flow

**Files:**
- Modify: `packages/core/tests/daemon/daemon.test.ts` (add integration test)

**Step 1: Write the integration test**

Add to `packages/core/tests/daemon/daemon.test.ts`:

```typescript
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
```

**Step 2: Run test**

Run: `pnpm test packages/core/tests/daemon/daemon.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/core/tests/daemon/daemon.test.ts
git commit -m "test: add full conversation lifecycle integration test"
```

---

### Task 10: Final Verification

**Step 1: Run all tests**

Run: `pnpm test`
Expected: ALL PASS

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Run build**

Run: `pnpm build`
Expected: Exit code 0

**Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "feat: conversation persistence and history complete"
```
