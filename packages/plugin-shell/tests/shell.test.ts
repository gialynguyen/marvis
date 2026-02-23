import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShellPlugin } from "../src";

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
    expect(plugin.manifest.name).toBe("Shell Commands");
    expect(plugin.manifest.version).toBe("1.0.0");
    expect(plugin.manifest.capabilities).toContain("execute_shell");
    expect(plugin.manifest.capabilities).toContain("read_env");
  });

  it("should provide execute_command tool", () => {
    const tools = plugin.getTools();
    const execTool = tools.find((t) => t.name === "execute_command");

    expect(execTool).toBeDefined();
    expect(execTool?.description).toContain("shell command");
    expect(execTool?.dangerLevel).toBe("dangerous");
  });

  it("should execute a simple command", async () => {
    const tools = plugin.getTools();
    const execTool = tools.find((t) => t.name === "execute_command");

    const result = await execTool?.execute({ command: "echo hello" });

    expect(result).toBeDefined();
    expect(result?.content).toBeInstanceOf(Array);
    expect(result?.content[0]).toEqual({
      text: "hello",
      type: "text",
    });
    expect(result?.details).toEqual({
      command: "echo hello",
      cwd: undefined,
      timeout: undefined,
    });
  });

  it("should execute a command with cwd option", async () => {
    const tools = plugin.getTools();
    const execTool = tools.find((t) => t.name === "execute_command");

    const result = await execTool?.execute({ command: "pwd", cwd: "/tmp" });

    expect(result).toBeDefined();
    expect(result?.content[0]?.text).toContain("/tmp");
    expect(result?.details?.cwd).toBe("/tmp");
  });

  it("should throw on a failing command", async () => {
    const tools = plugin.getTools();
    const execTool = tools.find((t) => t.name === "execute_command");

    await expect(
      execTool?.execute({ command: "exit 1" }),
    ).rejects.toThrow("Command failed");
  });

  it("should provide get_env tool", () => {
    const tools = plugin.getTools();
    const envTool = tools.find((t) => t.name === "get_env");

    expect(envTool).toBeDefined();
    expect(envTool?.dangerLevel).toBe("safe");
  });

  it("should get environment variables", async () => {
    const tools = plugin.getTools();
    const envTool = tools.find((t) => t.name === "get_env");

    // PATH should exist on all systems
    const result = await envTool?.execute({ name: "PATH" });

    expect(result).toBeDefined();
    expect(result?.content).toBeInstanceOf(Array);
    expect(result?.content[0]?.type).toBe("text");
    expect(result?.content[0]?.text).toContain("Value of PATH:");
    expect(result?.content[0]?.text).not.toContain("null");
    expect(result?.details).toEqual({ name: "PATH" });
  });

  it("should return result with null value text for non-existent env var", async () => {
    const tools = plugin.getTools();
    const envTool = tools.find((t) => t.name === "get_env");

    const result = await envTool?.execute({ name: "NON_EXISTENT_VAR_12345" });

    expect(result).toBeDefined();
    expect(result?.content[0]?.text).toBe(
      "Value of NON_EXISTENT_VAR_12345: null",
    );
    expect(result?.details).toEqual({ name: "NON_EXISTENT_VAR_12345" });
  });

  it("should return system prompt fragment", () => {
    const fragment = plugin.getSystemPromptFragment();
    expect(fragment).toContain("Shell");
    expect(fragment).toContain("execute_command");
    expect(fragment).toContain("get_env");
  });

  it("should start in tools mode", () => {
    expect(plugin.mode).toBe("tools");
  });

  it("should report healthy on health check", async () => {
    const health = await plugin.healthCheck();
    expect(health.healthy).toBe(true);
  });
});
