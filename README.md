# Polybrain MCP Server

An MCP (Model Context Protocol) server for connecting AI agents to multiple LLM models. Supports conversation history, model switching, and seamless Claude Code integration.

## Features

- Multi-model support (OpenAI, OpenRouter, custom endpoints)
- Conversation history management
- Switch models mid-conversation
- Extended thinking/reasoning support (configurable by provider)
- Pure MCP protocol (silent by default)
- Automatic server management

## Installation

```bash
npm install -g polybrain-mcp-server
# or
pnpm add -g polybrain-mcp-server
```

## Quick Setup

### 1. Configure Models

**Option A: YAML (recommended)**

Create `~/.polybrain.yaml`:
```yaml
models:
  - id: "gpt-4o"
    modelName: "gpt-4o"
    baseUrl: "https://api.openai.com/v1"
    apiKey: "${OPENAI_API_KEY}"
    provider: "openai"

  - id: "gpt-5.1"
    modelName: "openai/gpt-5.1"
    baseUrl: "https://openrouter.io/api/v1"
    apiKey: "${OPENROUTER_KEY}"
    provider: "openrouter"
```

Set env vars:
```bash
export OPENAI_API_KEY="sk-..."
export OPENROUTER_KEY="sk-or-..."
```

**Option B: Environment variables**

```bash
export POLYBRAIN_BASE_URL="https://api.openai.com/v1"
export POLYBRAIN_API_KEY="sk-..."
export POLYBRAIN_MODEL_NAME="gpt-4o"
```

### 2. Add to Claude Code

Open Claude Code settings → MCP Servers, add:

```json
{
  "mcpServers": {
    "polybrain": {
      "command": "polybrain"
    }
  }
}
```

Done! You can now use:
- `chat` - Talk to any configured model
- `list_models` - See available models
- `conversation_history` - Access past conversations

## Configuration Reference

### Environment Variables

- `POLYBRAIN_BASE_URL` - LLM API base URL
- `POLYBRAIN_API_KEY` - API key
- `POLYBRAIN_MODEL_NAME` - Model name
- `POLYBRAIN_HTTP_PORT` - Server port (default: 32701)
- `POLYBRAIN_LOG_LEVEL` - Log level (default: info)
- `POLYBRAIN_DEBUG` - Enable debug logging to stderr
- `POLYBRAIN_CONFIG_PATH` - Custom config file path

### YAML Config Fields

```yaml
httpPort: 32701                    # Optional
truncateLimit: 500                 # Optional
logLevel: info                      # Optional

models:                             # Required
  - id: "model-id"                 # Internal ID
    modelName: "actual-model-name"  # API model name
    baseUrl: "https://api.url/v1"  # API endpoint
    apiKey: "key or ${ENV_VAR}"    # API key
    provider: "openai"              # Optional: provider type for reasoning support
```

### Supported Providers

The `provider` field enables provider-specific features like extended thinking/reasoning. If not specified, reasoning parameters will not be passed to the API (safe default).

| Provider | Reasoning Support | Valid Values |
|----------|-------------------|--------------|
| OpenAI | YES | `"openai"` |
| OpenRouter | VARIES | `"openrouter"` |

**Examples:**
- Use `provider: "openai"` for OpenAI API models (GPT-4, o-series)
- Use `provider: "openrouter"` for OpenRouter proxy service (supports 400+ models)
- Omit `provider` field if your endpoint doesn't support reasoning parameters

**Example with reasoning:**
```yaml
models:
  - id: "gpt-o1"
    modelName: "o1"
    baseUrl: "https://api.openai.com/v1"
    apiKey: "${OPENAI_API_KEY}"
    provider: "openai"           # Enables reasoning support

  - id: "gpt-5.1"
    modelName: "openai/gpt-5.1"
    baseUrl: "https://openrouter.io/api/v1"
    apiKey: "${OPENROUTER_KEY}"
    provider: "openrouter"       # Enables reasoning support
```

To use reasoning, set `reasoning: true` in the chat tool call. If the model and provider support it, you'll receive both the response and reasoning content.

## Development

### Setup
```bash
pnpm install
```

### Build
```bash
pnpm build
```

### Lint & Format
```bash
pnpm lint
pnpm format
```

### Type Check
```bash
pnpm type-check
```

### Development Mode
```bash
pnpm dev
```

## Project Structure

```
src/
├── bin/polybrain.ts    # CLI entry point
├── launcher.ts         # Server launcher & management
├── http-server.ts      # HTTP server
├── index.ts            # Main server logic
├── mcp-tools.ts        # MCP tool definitions
├── conversation-manager.ts
├── openai-client.ts
├── config.ts
├── logger.ts
└── types.ts
```

## How It Works

1. Launcher checks if HTTP server is running
2. Starts server in background if needed
3. Connects to Claude Code via stdio MCP
4. Routes requests to HTTP backend
5. Maintains conversation history
6. Responds with MCP protocol messages

## Debugging

Enable debug logs to stderr:
```json
{
  "mcpServers": {
    "polybrain": {
      "command": "polybrain",
      "env": {
        "POLYBRAIN_DEBUG": "true"
      }
    }
  }
}
```

## Restart Server

After changing configuration in `~/.polybrain.yaml`, restart the HTTP backend server:

```bash
polybrain --restart
```

This kills the background HTTP server. The next time you use polybrain, it will automatically start a fresh server with the updated configuration.

## License

MIT
