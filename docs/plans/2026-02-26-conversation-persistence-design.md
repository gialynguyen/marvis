# Conversation Persistence & History — Design

> **⚠️ Post-Migration Note (2026-02-27):** This document was written before the monorepo migration.
> The project has been restructured from a flat `src/` layout into a pnpm monorepo with:
> - `packages/core/` (@marvis/core) — Core logic, daemon, memory, plugin system, types
> - `packages/plugin-shell/` (@marvis/plugin-shell) — Shell command plugin
> - `apps/cli/` (@marvis/cli) — CLI interface
>
> All file paths, import paths, and build commands in this document have been updated to reflect the new structure.
> Build: `pnpm build` (Turborepo) | Test: `pnpm test` | Lint: `pnpm lint` (Biome.js)

## Goal

Wire up existing SQLite infrastructure so users can list, resume, switch, and browse conversations from the REPL.

## Architecture

Most infrastructure exists (SQLite schema, MemoryStore methods, MarvisAgent.loadConversation). This feature adds three daemon handlers (`history`, `list_conversations`, `switch_conversation`), two IPC types, two REPL commands (`/conversations`, `/switch`), one new MemoryStore method (`updateConversationTitle`), and auto-titling from the first user message.

## Scope

### In Scope

- `/history` — display messages in current conversation (daemon handler missing)
- `/conversations` — list all conversations with title, date, message count, active marker
- `/switch <id>` — switch to a different conversation (partial ID matching)
- `/new` — already works, no changes
- Auto-titling from first user message (truncated to 80 chars)
- `updateConversationTitle()` on MemoryStore
- All new IPC types and daemon handlers
- TDD for all changes

### Out of Scope

- Conversation deletion
- Conversation search/filter
- LLM-generated titles
- Conversation export
- Pagination for `/history`

## Changes

### 1. `packages/core/src/types/index.ts` — Add IPC Types

Add `"list_conversations"` and `"switch_conversation"` to `IPCRequestType` union.

### 2. `packages/core/src/core/memory/store.ts` — Add `updateConversationTitle()`

New method: `async updateConversationTitle(id: string, title: string): Promise<void>` — updates the `title` column for a conversation.

### 3. `packages/core/src/daemon/daemon.ts` — Add Three Handlers

- `handleHistory()` — calls `memoryStore.getMessages(currentConversationId)`, returns `StoredMessage[]`
- `handleListConversations()` — calls `memoryStore.listConversations()`, returns `Conversation[]`
- `handleSwitchConversation(request)` — validates conversation exists, updates `currentConversationId`, calls `marvisAgent.loadConversation(id)`, returns success

Also: wire auto-titling into `handlePrompt()` — after first user message in a conversation, update title.

### 4. `apps/cli/src/cli/repl.ts` — Add REPL Commands

- `/conversations` — sends `list_conversations` IPC, renders table with ID (first 8 chars), title, date, message count, active marker
- `/switch <id>` — sends `switch_conversation` IPC with partial ID, renders confirmation

Update `/help` to list new commands.

### 5. Auto-Titling Logic

In `handlePrompt()`: after `marvisAgent.prompt()`, check if conversation has a title. If not, use the user's first message (truncated to 80 chars) as the title via `memoryStore.updateConversationTitle()`.
