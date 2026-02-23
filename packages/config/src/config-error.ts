export class ConfigError extends Error {
  constructor(
    public readonly path: string,
    public readonly expected: string,
    public readonly received: string,
    public readonly source: string,
  ) {
    const message = `ConfigError: Invalid value at '${path}'
  Expected: ${expected}
  Received: ${JSON.stringify(received)}
  Source: ${source}`;
    super(message);
    this.name = "ConfigError";
  }
}
