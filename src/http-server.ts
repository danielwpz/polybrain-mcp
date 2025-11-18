import type { Server } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type { Express, Request, Response } from "express";
import { logger } from "./logger.js";

export class HTTPServer {
  private app: Express;
  private httpServer: Server | null = null;
  private mcpServer: McpServer;
  private port: number;

  constructor(mcpServer: McpServer, port: number) {
    this.mcpServer = mcpServer;
    this.port = port;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get("/health", (_req: Request, res: Response) => {
      logger.debug("Health check request");
      res.json({ status: "ok" });
    });

    // Stateless MCP endpoint - create a new transport for each request
    // This prevents session management complexity and allows stateless operation
    this.app.post("/mcp", express.json(), async (req: Request, res: Response) => {
      logger.debug("MCP POST request", { method: req.body?.method });

      // Create a new stateless transport for this request
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode - no session IDs
        enableJsonResponse: true, // Return JSON response instead of SSE stream
      });

      // Clean up transport when response is sent or connection closes
      res.on("close", () => {
        transport.close();
      });

      try {
        // Connect the MCP server to the transport
        await this.mcpServer.connect(transport);

        // Handle the request - response will be sent as JSON
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        logger.error("Error handling MCP request", error as Error);
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error" });
        }
      }
    });

    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      logger.debug("404 - not found", { url: _req.url });
      res.status(404).json({ error: "Not found" });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer = this.app.listen(this.port, () => {
          logger.info("HTTP server started", { port: this.port });
          resolve();
        });

        this.httpServer.on("error", (error: Error) => {
          logger.error("HTTP server error", error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        resolve();
        return;
      }

      this.httpServer.close((error) => {
        if (error) {
          logger.error("Error closing HTTP server", error);
          reject(error);
        } else {
          logger.info("HTTP server stopped");
          resolve();
        }
      });
    });
  }

  isRunning(): boolean {
    return this.httpServer?.listening || false;
  }

  getPort(): number {
    return this.port;
  }
}
