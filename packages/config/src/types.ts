// src/types.ts
import { type Static, Type } from "@sinclair/typebox";

// ============= Config Schema Types =============

const ProviderSchema = Type.Union([
  Type.Literal("openai"),
  Type.Literal("anthropic"),
  Type.Literal("google"),
  Type.Literal("zai"),
]);

const LogLevelSchema = Type.Union([
  Type.Literal("debug"),
  Type.Literal("info"),
  Type.Literal("warn"),
  Type.Literal("error"),
]);

const LogFormatSchema = Type.Union([Type.Literal("text"), Type.Literal("json")]);

const DangerThresholdSchema = Type.Union([Type.Literal("moderate"), Type.Literal("dangerous")]);

export const MarvisConfigSchema = Type.Object({
  llm: Type.Object({
    provider: ProviderSchema,
    model: Type.String(),
    fallbackProvider: Type.Optional(ProviderSchema),
    fallbackModel: Type.Optional(Type.String()),
    apiKey: Type.Optional(Type.String()),
  }),
  tools: Type.Object({
    confirmDangerous: Type.Boolean(),
    dangerThreshold: DangerThresholdSchema,
  }),
  system: Type.Object({
    systemPrompt: Type.String(),
  }),
  paths: Type.Object({
    dataDir: Type.String(),
    logDir: Type.String(),
    socketPath: Type.String(),
  }),
  logging: Type.Object({
    level: LogLevelSchema,
    format: LogFormatSchema,
    file: Type.Optional(Type.String()),
  }),
  plugins: Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
  aliases: Type.Record(Type.String(), Type.String()),
});

export type MarvisConfigFromSchema = Static<typeof MarvisConfigSchema>;

// ============= Config Types =============

export interface MarvisConfig extends MarvisConfigFromSchema {}

export interface DaemonConfig {
  socketPath: string;
  pidFile: string;
  logFile: string;
  dbPath: string;
  marvisConfig: MarvisConfig;
}
