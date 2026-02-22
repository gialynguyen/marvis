import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShellPlugin } from "../../../src/plugins/shell/index.js";

describe("ShellPlugin", () => {
  let plugin: ShellPlugin;

  beforeEach(async () => {
    plugin = new ShellPlugin();
    await plugin.initialize({});
  });

  afterEach(async () => {
    await plugin.shutdown();
  });

  it("should have correct manifest", () => {
    expect(plugin.manifest.id).toBe("shell");
    expect(plugin.manifest.capabilities).toContain("execute_shell");
  });

  it("should provide execute_command tool", () => {
    const tools = plugin.getTools();
    const execTool = tools.find((t) => t.name === "execute_command");

    expect(execTool).toBeDefined();
    expect(execTool?.description).toContain("shell command");
  });

  it("should execute a simple command", async () => {
    const tools = plugin.getTools();
    const execTool = tools.find((t) => t.name === "execute_command");

    const result = await execTool?.execute({ command: "echo hello" });
    expect(result).toContain("hello");
  });

  it("should provide get_env tool", () => {
    const tools = plugin.getTools();
    const envTool = tools.find((t) => t.name === "get_env");

    expect(envTool).toBeDefined();
  });

  it("should get environment variables", async () => {
    const tools = plugin.getTools();
    const envTool = tools.find((t) => t.name === "get_env");

    // PATH should exist on all systems
    const result = await envTool?.execute({ name: "PATH" });
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("should return null for non-existent env var", async () => {
    const tools = plugin.getTools();
    const envTool = tools.find((t) => t.name === "get_env");

    const result = await envTool?.execute({ name: "NON_EXISTENT_VAR_12345" });
    expect(result).toBeNull();
  });

  it("should return system prompt fragment", () => {
    const fragment = plugin.getSystemPromptFragment();
    expect(fragment).toContain("Shell");
    expect(fragment).toContain("execute_command");
  });
});
