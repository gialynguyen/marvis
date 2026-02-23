# Marvis

Personal AI assistant daemon with plugin architecture, built on the Pi agent framework.

## Features

- **Daemon Architecture**: Runs as a background process with Unix socket IPC
- **Plugin System**: Extensible via plugins that can be promoted to full agents
- **Persistent Memory**: SQLite-backed conversation and long-term memory
- **LLM Integration**: Multi-provider support (Anthropic, OpenAI, Google) via Pi Agent framework

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

### Chat with Marvis

```bash
# Start interactive chat (daemon must be running)
npm run cli -- chat
```

**REPL Commands:**
- `/help` - Show available commands
- `/new` - Start a new conversation
- `/history` - Show conversation history
- `/model <provider> <model>` - Switch LLM model
- `/quit` - Exit chat

## Configuration

**Environment Variables:**
```bash
# Required: At least one API key
ANTHROPIC_API_KEY="sk-ant-..."
OPENAI_API_KEY="sk-..."
GEMINI_API_KEY="..."

# Optional: Override defaults
MARVIS_PROVIDER="anthropic"           # anthropic | openai | google
MARVIS_MODEL="claude-sonnet-4-0"      # Model name for provider
MARVIS_CONFIRM_DANGEROUS="true"       # Require confirmation for dangerous tools
MARVIS_DANGER_THRESHOLD="dangerous"   # dangerous | moderate
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
