import { describe, it, expect } from "vitest";
import { parseCommand } from "../src/cli/repl.js";

describe("parseCommand", () => {
  it("returns null for non-command input", () => {
    expect(parseCommand("hello world")).toBeNull();
  });

  it("parses a command with no args", () => {
    expect(parseCommand("/help")).toEqual({ command: "help", args: [] });
  });

  it("parses a command with args", () => {
    expect(parseCommand("/model anthropic claude-3")).toEqual({
      command: "model",
      args: ["anthropic", "claude-3"],
    });
  });
});

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

describe("MarvisREPL prompt label", () => {
  it("uses 'user> ' as the readline prompt", async () => {
    const { MarvisREPL } = await import("../src/cli/repl.js");
    const repl = new MarvisREPL("nonexistent.sock") as any;
    expect(repl.PROMPT).toBe("user> ");
  });
});

describe("MarvisREPL welcome message", () => {
  it("prints a greeting from Marvis when started", async () => {
    const written: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: any) => {
      written.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    };

    const { MarvisREPL } = await import("../src/cli/repl.js");
    const repl = new MarvisREPL("nonexistent.sock");
    const replAsAny = repl as any;
    replAsAny.rl = {
      on: () => {},
      prompt: () => {},
    };

    const originalLog = console.log;
    const logged: string[] = [];
    console.log = (...args: any[]) => logged.push(args.join(" "));

    try {
      await replAsAny.printWelcome();
      expect(logged.join("\n")).toContain("Marvis");
    } finally {
      console.log = originalLog;
      process.stdout.write = originalWrite;
    }
  });
});
