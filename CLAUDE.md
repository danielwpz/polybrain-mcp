# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Polybrain MCP Server is a stateless HTTP-based Model Context Protocol (MCP) server that enables communication with multiple LLM models. It maintains per-request conversation isolation with application-level conversation state management.

## Architecture

### Core Components

1. **HTTP Server** (`src/http-server.ts`): Express-based stateless server using `StreamableHTTPServerTransport`
   - Creates a new transport instance per HTTP request (stateless design)
   - Accepts POST requests to `/mcp` endpoint with `Accept: application/json, text/event-stream` header
   - Returns JSON responses directly in HTTP body (not SSE streams)
   - Cleans up transport on request completion

2. **MCP Server** (`src/index.ts`): Initializes and manages the MCP server
   - Registers tools: `chat`, `list_models`, `conversation_history`
   - Handles both HTTP transport (stateless mode) and stdio transport

3. **Conversation Manager** (`src/conversation-manager.ts`): In-memory conversation storage
   - Maps conversation IDs to message history
   - Handles conversation cloning when switching models mid-conversation
   - Supports message truncation for context management

4. **OpenAI Client** (`src/openai-client.ts`): LLM API integration
   - Supports any OpenAI-compatible API endpoint (OpenRouter, Azure, local servers)
   - Per-model API keys from configuration
   - Handles reasoning/extended-thinking responses (optional)

5. **Configuration** (`src/config.ts`): Dual-mode config system
   - Simple environment variables (single model): `POLYBRAIN_BASE_URL`, `POLYBRAIN_API_KEY`, `POLYBRAIN_MODEL_NAME`
   - YAML configuration (multiple models): `~/.polybrain.yaml` or `POLYBRAIN_CONFIG_PATH`
   - Environment variable substitution in YAML: `${ENV_VAR_NAME}`

### Critical Design: Stateless HTTP Protocol

The server uses `StreamableHTTPServerTransport` with these key settings:
- `sessionIdGenerator: undefined` - No session persistence
- `enableJsonResponse: true` - Returns JSON responses instead of SSE streams
- Per-request transport lifecycle - Each HTTP request gets a fresh transport instance

**Protocol Flow:**
1. Client POSTs MCP JSON-RPC request to `/mcp`
2. Server creates transport, connects MCP server, handles request
3. Response returned in HTTP POST body as JSON (Status 200)
4. Transport cleaned up when response completes

**Client Requirements:**
- Send `Accept: application/json, text/event-stream` header (required by StreamableHTTPServerTransport)
- POST JSON-RPC messages to `/mcp`
- Expect JSON response in body, not SSE stream

## Common Development Commands

```bash
# Setup
pnpm install

# Development (with auto-reload)
pnpm dev

# Build TypeScript
pnpm build

# Run HTTP server only (for testing)
POLYBRAIN_BASE_URL="https://api.openai.com/v1" \
POLYBRAIN_API_KEY="sk-..." \
POLYBRAIN_MODEL_NAME="gpt-4o" \
pnpm start

# Lint and format
pnpm lint
pnpm format

# Type checking
pnpm type-check
```

## Configuration

### Simple Mode (Single Model)

```bash
export POLYBRAIN_BASE_URL="https://api.openai.com/v1"
export POLYBRAIN_API_KEY="sk-..."
export POLYBRAIN_MODEL_NAME="gpt-4o"
export POLYBRAIN_HTTP_PORT=32701  # optional, default 3000
export POLYBRAIN_LOG_LEVEL=info   # optional, default info
pnpm start
```

### YAML Mode (Multiple Models)

Create `~/.polybrain.yaml`:
```yaml
httpPort: 32701
logLevel: info
truncateLimit: 500

models:
  - id: "gpt-4o"
    modelName: "gpt-4o"
    baseUrl: "https://api.openai.com/v1"
    apiKey: "${OPENAI_API_KEY}"

  - id: "gpt-mini"
    modelName: "gpt-4o-mini"
    baseUrl: "https://api.openai.com/v1"
    apiKey: "${OPENAI_API_KEY}"

  - id: "claude"
    modelName: "claude-3-5-sonnet-20241022"
    baseUrl: "https://openrouter.io/api/v1"
    apiKey: "${OPENROUTER_KEY}"
```

## MCP Tools

### `chat` Tool

Makes LLM requests. Conversation history is maintained at the application level (not MCP level).

**Parameters:**
- `message` (string, required): User message
- `conversationId` (string, optional): Continue existing conversation
- `modelId` (string, optional): Model to use (uses default if not specified)
- `reasoning` (boolean, optional): Include extended thinking

**Returns:**
```json
{
  "conversationId": "uuid",
  "response": "LLM response text",
  "modelId": "gpt-4o"
}
```

### `list_models` Tool

Returns available models from configuration. First model is the default.

### `conversation_history` Tool

Returns message history for a conversation with truncation support.

## Key Implementation Details

### Conversation Storage

- In-memory only (lost on server restart)
- Each conversation has a unique UUID
- Messages stored as `{role: "user" | "assistant", content: string}`
- Long conversations auto-truncate (keep first N and last N messages with marker)

### Model Cloning

When calling `chat()` with different `modelId` and existing `conversationId`:
- If same model: continues conversation
- If different model: clones conversation history to new model, returns new `conversationId`

### Error Handling

- OpenAI API errors are caught and returned as JSON-RPC errors
- HTTP request timeout: 20 seconds (configured in tests)
- Missing Accept header returns 406 (Not Acceptable)

## Testing

Test files created during development:
- `/tmp/test_simple.js` - Basic stateless HTTP test
- `/tmp/get_response.js` - Extract LLM response from parsed JSON

**Test LLM with:**
```bash
node /tmp/test_simple.js
# or to see raw response
node /tmp/get_response.js
```

## Important Notes

1. **Conversation History is App-Level**: The server doesn't manage conversation continuity through sessions. Application must track conversation IDs and pass them back for multi-turn conversations.

2. **Stateless Design**: Each HTTP request is independent. The server doesn't maintain client sessions or connection state.

3. **Configuration Priority**:
   - If all three simple env vars are set: use them, ignore YAML
   - Otherwise: use YAML config if present
   - Error if neither configured

4. **Per-Model API Keys**: Each model in YAML config has its own API key, allowing integration with multiple API providers simultaneously.

5. **Express vs Hono**: Currently uses Express for HTTP server. Package includes both Express and Hono dependencies (Hono unused at moment).

## Debugging

```bash
# Enable debug logging
POLYBRAIN_LOG_LEVEL=debug pnpm start

# Change HTTP port if default in use
POLYBRAIN_HTTP_PORT=3001 pnpm start

# Check configuration is loaded
POLYBRAIN_LOG_LEVEL=debug pnpm start | grep -i config
```

## Restarting the Server

After making changes (code, config, tool descriptions, etc.), restart with:

```bash
polybrain --restart
```

This kills the background HTTP server. The next time you use polybrain, it automatically starts a fresh server with the updated configuration/code.

**When to restart:**
- After editing `~/.polybrain.yaml` config
- After rebuilding code (`pnpm build`)
- After updating MCP tool descriptions
- When configuration env vars change

## Recent Changes (End-to-End Fix)

The server was recently fixed to properly return responses to HTTP clients by:
- Switching from SSEServerTransport (two-endpoint pattern) to StreamableHTTPServerTransport (single endpoint)
- Enabling JSON response mode (`enableJsonResponse: true`)
- Creating transport per request instead of maintaining sessions
- Clients now receive LLM responses directly in POST response body

This makes the server properly stateless and suitable for serverless/cloud deployments.
