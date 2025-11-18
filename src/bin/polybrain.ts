#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config.js";
import { ConversationManager } from "../conversation-manager.js";
import { ServerLauncher } from "../launcher.js";
import { logger, setLogLevel } from "../logger.js";
import { registerTools } from "../mcp-tools.js";
import { OpenAIClient } from "../openai-client.js";

/**
 * Log only if debug mode is enabled via POLYBRAIN_DEBUG env var
 * This ensures launcher stdio stays pure for MCP protocol
 */
function debugLog(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown> | Error
): void {
  if (process.env.POLYBRAIN_DEBUG === "true") {
    logger[level](message, context);
  }
}

async function main(): Promise<void> {
  try {
    // In stdio mode, suppress all logging by default to keep stdout pure for MCP protocol
    // Only enable logging if POLYBRAIN_DEBUG is explicitly set
    // Do this BEFORE loading config to suppress config logs
    if (process.env.POLYBRAIN_DEBUG !== "true") {
      setLogLevel("error"); // Suppress debug/info logs even if configured
    }

    const config = loadConfig();

    if (process.env.POLYBRAIN_DEBUG === "true") {
      setLogLevel(config.logLevel);
      debugLog("debug", "Polybrain launcher started (debug mode)");
    }

    // Ensure HTTP server is running
    const launcher = new ServerLauncher(config.httpPort);
    await launcher.ensureServerRunning();

    debugLog("debug", "HTTP server is ready, starting MCP stdio mode");

    // Initialize conversation manager
    const conversationManager = new ConversationManager(config.truncateLimit);

    // Initialize OpenAI clients for each model
    const openaiClients = new Map<string, OpenAIClient>();
    for (const model of config.models) {
      openaiClients.set(model.id, new OpenAIClient(model.apiKey, model.baseUrl));
    }

    // Create MCP server
    const mcpServer = new McpServer({
      name: "polybrain",
      version: "1.0.0",
    });

    // Register tools
    registerTools(mcpServer, conversationManager, openaiClients, config);

    // Connect via stdio
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    debugLog("debug", "MCP server connected via stdio");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debugLog(
      "error",
      "Failed to start MCP server",
      error instanceof Error ? error : new Error(errorMessage)
    );
    // Exit with error code - agent will handle the connection failure
    process.exit(1);
  }
}

main();
