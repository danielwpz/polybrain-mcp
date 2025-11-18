import * as net from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { ConversationManager } from "./conversation-manager.js";
import { HTTPServer } from "./http-server.js";
import { logger, setLogLevel } from "./logger.js";
import { registerTools } from "./mcp-tools.js";
import { OpenAIClient } from "./openai-client.js";

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once("listening", () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

async function startServerOnly(): Promise<void> {
  try {
    const config = loadConfig();
    setLogLevel(config.logLevel);

    // Check if server is already running
    const portInUse = await isPortInUse(config.httpPort);
    if (portInUse) {
      logger.info("Polybrain MCP Server is already running", {
        port: config.httpPort,
      });
      process.exit(0);
    }

    logger.info("Starting Polybrain MCP Server (HTTP mode)", {
      port: config.httpPort,
      models: config.models.length,
    });

    // Initialize conversation manager
    const conversationManager = new ConversationManager(config.truncateLimit);

    // Initialize OpenAI clients for each model
    const openaiClients = new Map<string, OpenAIClient>();
    for (const model of config.models) {
      openaiClients.set(model.id, new OpenAIClient(model.apiKey, model.baseUrl));
      logger.debug("Registered model", { modelId: model.id, baseUrl: model.baseUrl });
    }

    // Create MCP server
    const mcpServer = new McpServer({
      name: "polybrain",
      version: "1.0.0",
    });

    // Register tools
    registerTools(mcpServer, conversationManager, openaiClients, config);

    // Start HTTP server
    const httpServer = new HTTPServer(mcpServer, config.httpPort);
    await httpServer.start();

    // Handle graceful shutdown
    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down gracefully");
      await httpServer.stop();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down gracefully");
      await httpServer.stop();
      process.exit(0);
    });

    logger.info("Polybrain MCP Server is ready");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      "Failed to start server",
      error instanceof Error ? error : new Error(errorMessage)
    );
    process.exit(1);
  }
}

async function startStdioMode(): Promise<void> {
  try {
    const config = loadConfig();
    setLogLevel(config.logLevel);

    logger.info("Starting Polybrain MCP Server (stdio mode)");

    // Initialize conversation manager
    const conversationManager = new ConversationManager(config.truncateLimit);

    // Initialize OpenAI clients for each model
    const openaiClients = new Map<string, OpenAIClient>();
    for (const model of config.models) {
      openaiClients.set(model.id, new OpenAIClient(model.apiKey, model.baseUrl));
      logger.debug("Registered model", { modelId: model.id, baseUrl: model.baseUrl });
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

    logger.info("Polybrain MCP Server connected via stdio");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      "Failed to start server",
      error instanceof Error ? error : new Error(errorMessage)
    );
    process.exit(1);
  }
}

// Determine which mode to run
const isServerOnly = process.env.POLYBRAIN_HTTP_SERVER_ONLY === "true";

if (isServerOnly) {
  startServerOnly().catch((error) => {
    logger.error("Server start error", error);
    process.exit(1);
  });
} else {
  startStdioMode().catch((error) => {
    logger.error("Server start error", error);
    process.exit(1);
  });
}
