import { watch, existsSync, type FSWatcher } from "node:fs";
import { dirname } from "node:path";
import { getConfigPath } from "./config";
import { basename } from "node:path";

export type ConfigChangeCallback = () => void;

/**
 * Watches the Marvis config file for changes using `fs.watch`.
 * Debounces rapid filesystem events (common on macOS/Linux) to avoid
 * triggering multiple reloads for a single save operation.
 */
export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private configPath: string;

  constructor(debounceMs = 300) {
    this.debounceMs = debounceMs;
    this.configPath = getConfigPath();
  }

  /** Start watching the config file for changes */
  start(onChange: ConfigChangeCallback): void {
    if (this.watcher) {
      return; // Already watching
    }

    const configDir = dirname(this.configPath);
    const configFileName = basename(this.configPath);

    if (!existsSync(configDir)) {
      return; // Config directory doesn't exist yet
    }

    // Watch the directory instead of the file directly.
    // Some editors (vim, etc.) delete + recreate the file on save,
    // which would break a direct file watch.
    this.watcher = watch(configDir, (eventType, filename) => {
      // On some platforms (macOS), filename can be null.
      // Only proceed if the filename matches our config file.
      if (filename !== null && filename !== configFileName) {
        return; // Not our config file
      }

      // Debounce: many editors trigger multiple events for a single save
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        // Only fire if the file still exists (ignore delete events)
        if (existsSync(this.configPath)) {
          onChange();
        }
      }, this.debounceMs);
    });

    // Don't let the watcher keep the process alive
    this.watcher.unref();
  }

  /** Stop watching the config file */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /** Whether the watcher is currently active */
  isWatching(): boolean {
    return this.watcher !== null;
  }
}
