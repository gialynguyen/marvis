# Marvis

Personal AI assistant daemon with plugin architecture, built on the Pi agent framework.

## Features

- **Daemon Architecture**: Runs as a background process with Unix socket IPC
- **Plugin System**: Extensible via plugins that can be promoted to full agents
- **Persistent Memory**: SQLite-backed conversation and long-term memory
- **LLM Integration**: Multi-provider support (Anthropic, OpenAI, Google) via Pi Agent framework

## Installation

```bash
pnpm install
pnpm build
```

## Usage

### Start the daemon

```bash
# Background mode
node apps/cli/dist/bin/marvis.js start

# Foreground mode (for development)
node apps/cli/dist/bin/marvis.js start --foreground
```

### Check status

```bash
node apps/cli/dist/bin/marvis.js status
```

### List plugins

```bash
node apps/cli/dist/bin/marvis.js plugins
```

### Stop the daemon

```bash
node apps/cli/dist/bin/marvis.js stop
```

### Chat with Marvis

```bash
# Start interactive chat (daemon must be running)
node apps/cli/dist/bin/marvis.js chat
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
pnpm test

# Type check
pnpm typecheck

# Development mode (auto-restart)
pnpm dev
```

## Project Structure

```
packages/
  core/            # Core logic, daemon, memory
  plugin-shell/    # Shell command plugin
apps/
  cli/             # CLI interface
```


## License

MIT
