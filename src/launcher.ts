import { type ChildProcess, spawn } from "node:child_process";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export class ServerLauncher {
  private serverProcess: ChildProcess | null = null;
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  /**
   * Check if server is already running on the configured port
   */
  async isServerRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const request = http.get(`http://localhost:${this.port}/health`, { timeout: 2000 }, (res) => {
        resolve(res.statusCode === 200);
      });

      request.on("error", () => {
        resolve(false);
      });

      request.on("timeout", () => {
        request.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Start the HTTP server in background
   */
  async startServer(): Promise<void> {
    try {
      // Determine the correct path to the server script
      // Navigate up from dist/bin to dist/ to find index.js
      const serverScript = path.resolve(__dirname, "..", "index.js");

      debugLog("debug", "Starting HTTP server", { script: serverScript, port: this.port });

      this.serverProcess = spawn("node", [serverScript], {
        env: {
          ...process.env,
          POLYBRAIN_HTTP_SERVER_ONLY: "true",
        },
        detached: true,
        stdio: "ignore", // Detach from parent process
      });

      // Don't wait for the process to complete - just let it run in background
      this.serverProcess.unref();

      // Wait for server to be ready
      let retries = 0;
      const maxRetries = 30; // 30 seconds

      while (retries < maxRetries) {
        const isRunning = await this.isServerRunning();
        if (isRunning) {
          debugLog("info", "HTTP server is ready", { port: this.port });
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
        retries++;
      }

      throw new Error("Server failed to start within timeout");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      debugLog(
        "error",
        "Failed to start HTTP server",
        error instanceof Error ? error : new Error(errorMessage)
      );
      throw error;
    }
  }

  /**
   * Ensure server is running
   */
  async ensureServerRunning(): Promise<void> {
    try {
      const isRunning = await this.isServerRunning();

      if (!isRunning) {
        debugLog("info", "Server not running, starting it...");
        await this.startServer();
      } else {
        debugLog("debug", "Server already running");
      }
    } catch (error) {
      debugLog(
        "error",
        "Error ensuring server is running",
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Stop the server if running
   */
  async stopServer(): Promise<void> {
    if (this.serverProcess && !this.serverProcess.killed) {
      logger.info("Stopping server");
      this.serverProcess.kill();
    }
  }
}
