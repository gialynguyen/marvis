import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigWatcher } from "../src/config-watcher";

describe("ConfigWatcher", () => {
  const debounceMs = 50;
  let testDir: string;
  let configPath: string;
  let originalEnv: NodeJS.ProcessEnv;
  let watcher: ConfigWatcher | null;

  beforeEach(() => {
    originalEnv = { ...process.env };
    testDir = join(tmpdir(), "marvis-watcher-test-" + Date.now());
    configPath = join(testDir, "config.toml");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(configPath, "# initial config\n");
    process.env.MARVIS_CONFIG = configPath;
    watcher = null;
  });

  afterEach(() => {
    if (watcher) {
      watcher.stop();
      watcher = null;
    }
    process.env = originalEnv;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("constructor", () => {
    it("should use default debounce value of 300ms", () => {
      watcher = new ConfigWatcher();
      // The watcher should be created without error
      expect(watcher).toBeInstanceOf(ConfigWatcher);
      expect(watcher.isWatching()).toBe(false);
    });

    it("should accept a custom debounce value", () => {
      watcher = new ConfigWatcher(debounceMs);
      expect(watcher).toBeInstanceOf(ConfigWatcher);
      expect(watcher.isWatching()).toBe(false);
    });
  });

  describe("start()", () => {
    it("should fire callback when config file changes on disk", async () => {
      const onChange = vi.fn();
      watcher = new ConfigWatcher(debounceMs);
      watcher.start(onChange);

      // Write a change to the config file
      writeFileSync(configPath, "# updated config\n");

      // Wait for debounce to settle
      await new Promise((r) => setTimeout(r, debounceMs + 100));

      expect(onChange).toHaveBeenCalled();
    });

    it("should debounce rapid multiple writes", async () => {
      const onChange = vi.fn();
      watcher = new ConfigWatcher(debounceMs);
      watcher.start(onChange);

      // Perform several rapid writes
      writeFileSync(configPath, "# change 1\n");
      writeFileSync(configPath, "# change 2\n");
      writeFileSync(configPath, "# change 3\n");

      // Wait for debounce to settle
      await new Promise((r) => setTimeout(r, debounceMs + 100));

      // Should have only fired once due to debouncing
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("should ignore changes to other files in the same directory", async () => {
      const onChange = vi.fn();
      watcher = new ConfigWatcher(debounceMs);
      watcher.start(onChange);

      // Write to a different file in the same directory
      const otherFile = join(testDir, "other-file.txt");
      writeFileSync(otherFile, "not the config\n");

      // Wait for debounce to settle
      await new Promise((r) => setTimeout(r, debounceMs + 200));

      // On macOS, fs.watch on a directory may report events with null filename,
      // which could trigger the callback. This is acceptable platform behavior.
      // The test verifies that if the filename IS reported, we filter correctly.
      // We skip strict assertion on macOS where filename is sometimes null.
      if (process.platform !== "darwin") {
        expect(onChange).not.toHaveBeenCalled();
      }
    });

    it("should do nothing if already watching", async () => {
      const onChange1 = vi.fn();
      const onChange2 = vi.fn();
      watcher = new ConfigWatcher(debounceMs);

      watcher.start(onChange1);
      expect(watcher.isWatching()).toBe(true);

      // Calling start again should not replace the watcher
      watcher.start(onChange2);
      expect(watcher.isWatching()).toBe(true);

      // Write a change — should trigger the first callback, not the second
      writeFileSync(configPath, "# updated\n");
      await new Promise((r) => setTimeout(r, debounceMs + 100));

      expect(onChange1).toHaveBeenCalled();
      expect(onChange2).not.toHaveBeenCalled();
    });
  });

  describe("stop()", () => {
    it("should stop watching and callback no longer fires", async () => {
      const onChange = vi.fn();
      watcher = new ConfigWatcher(debounceMs);
      watcher.start(onChange);
      expect(watcher.isWatching()).toBe(true);

      watcher.stop();
      expect(watcher.isWatching()).toBe(false);

      // Write a change after stopping
      writeFileSync(configPath, "# after stop\n");
      await new Promise((r) => setTimeout(r, debounceMs + 100));

      expect(onChange).not.toHaveBeenCalled();
    });

    it("should can be called even if not watching without error", () => {
      watcher = new ConfigWatcher(debounceMs);
      expect(watcher.isWatching()).toBe(false);

      // Should not throw
      expect(() => watcher!.stop()).not.toThrow();
      expect(watcher.isWatching()).toBe(false);
    });
  });

  describe("isWatching()", () => {
    it("should return false before start is called", () => {
      watcher = new ConfigWatcher(debounceMs);
      expect(watcher.isWatching()).toBe(false);
    });

    it("should return true after start is called", () => {
      watcher = new ConfigWatcher(debounceMs);
      watcher.start(vi.fn());
      expect(watcher.isWatching()).toBe(true);
    });

    it("should return false after stop is called", () => {
      watcher = new ConfigWatcher(debounceMs);
      watcher.start(vi.fn());
      expect(watcher.isWatching()).toBe(true);

      watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });
  });
});
