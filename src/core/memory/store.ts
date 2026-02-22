import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Conversation, StoredMessage } from "../../types/index.js";
import type { ChatMessageInput } from "./types.js";

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string = "data/marvis.db") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        tokens_estimated INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation 
        ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated 
        ON conversations(updated_at DESC);

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        source_conversation_id TEXT,
        source_message_id TEXT,
        importance REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        embedding BLOB,
        FOREIGN KEY (source_conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
    `);
  }

  async createConversation(title?: string): Promise<string> {
    const id = randomUUID();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`
      )
      .run(id, title ?? null, now, now);

    return id;
  }

  async getLastConversationId(): Promise<string | null> {
    const row = this.db
      .prepare(`SELECT id FROM conversations ORDER BY updated_at DESC, ROWID DESC LIMIT 1`)
      .get() as { id: string } | undefined;

    return row?.id ?? null;
  }

  async conversationExists(id: string): Promise<boolean> {
    const row = this.db
      .prepare(`SELECT 1 FROM conversations WHERE id = ?`)
      .get(id);

    return !!row;
  }

  async listConversations(limit = 50): Promise<Conversation[]> {
    const rows = this.db
      .prepare(
        `SELECT id, title, created_at as createdAt, updated_at as updatedAt, metadata
         FROM conversations
          ORDER BY updated_at DESC, ROWID DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: string;
      title: string | null;
      createdAt: number;
      updatedAt: number;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  async addMessage(
    conversationId: string,
    message: ChatMessageInput
  ): Promise<string> {
    const id = randomUUID();
    const now = Date.now();
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    const tokensEstimated = Math.ceil(content.length / 4);

    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, tokens_estimated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        conversationId,
        message.role,
        content,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        message.toolCallId ?? null,
        tokensEstimated,
        now
      );

    this.db
      .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
      .run(now, conversationId);

    return id;
  }

  async getMessages(
    conversationId: string,
    limit?: number
  ): Promise<StoredMessage[]> {
    const query = limit
      ? `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?`
      : `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`;

    const rows = (
      limit
        ? this.db.prepare(query).all(conversationId, limit)
        : this.db.prepare(query).all(conversationId)
    ) as Array<{
      id: string;
      conversation_id: string;
      role: string;
      content: string;
      tool_calls: string | null;
      tool_call_id: string | null;
      tokens_estimated: number;
      created_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as StoredMessage["role"],
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolCallId: row.tool_call_id ?? undefined,
      tokensEstimated: row.tokens_estimated,
      createdAt: row.created_at,
    }));
  }

  async getMessageCount(conversationId: string): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`
      )
      .get(conversationId) as { count: number };

    return row.count;
  }

  async getTotalTokens(conversationId: string): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT SUM(tokens_estimated) as total FROM messages WHERE conversation_id = ?`
      )
      .get(conversationId) as { total: number | null };

    return row.total ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
