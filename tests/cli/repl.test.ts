import { describe, it, expect } from "vitest";
import { parseCommand } from "../../src/cli/repl.js";

describe("REPL", () => {
  describe("parseCommand", () => {
    it("should parse /help command", () => {
      const result = parseCommand("/help");
      expect(result).toEqual({ command: "help", args: [] });
    });

    it("should parse /model with args", () => {
      const result = parseCommand("/model openai gpt-4o");
      expect(result).toEqual({ command: "model", args: ["openai", "gpt-4o"] });
    });

    it("should return null for non-command input", () => {
      const result = parseCommand("hello world");
      expect(result).toBeNull();
    });
  });
});
