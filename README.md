# Marvis

Personal AI assistant daemon with plugin architecture, built on the Pi agent framework.

## Features

- **Daemon Architecture**: Runs as a background process with Unix socket IPC
- **Plugin System**: Extensible via plugins that can be promoted to full agents
- **Persistent Memory**: SQLite-backed conversation and long-term memory
- **Local-First LLM**: Ollama integration with cloud fallback

## Installation

```bash
npm install
npm run build
```

## Usage

### Start the daemon

```bash
# Background mode
npm run cli -- start

# Foreground mode (for development)
npm run cli -- start --foreground
```

### Check status

```bash
npm run cli -- status
```

### List plugins

```bash
npm run cli -- plugins
```

### Stop the daemon

```bash
npm run cli -- stop
```

## Development

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Development mode (auto-restart)
npm run dev
```

## Project Structure

```
src/
├── types/          # Shared TypeScript types
├── daemon/         # Daemon process and IPC
├── core/
│   └── memory/     # SQLite persistence
├── plugins/        # Plugin system
│   └── shell/      # Shell command plugin
├── cli/            # CLI interface
└── bin/            # Entry points
```

## License

MIT
