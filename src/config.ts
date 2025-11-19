import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { logger } from "./logger.js";
import type { LogLevel, ModelConfig, ServerConfig } from "./types.js";

type RawConfig = Record<string, unknown>;

/**
 * Resolve environment variable references in config values
 * Supports syntax like "${ENV_VAR_NAME}"
 */
function resolveEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
      const envValue = process.env[varName];
      if (!envValue) {
        throw new Error(`Environment variable not found: ${varName}`);
      }
      return envValue;
    });
  }
  if (typeof value === "object" && value !== null) {
    if (Array.isArray(value)) {
      return value.map((v) => resolveEnvVars(v));
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveEnvVars(v)]));
  }
  return value;
}

/**
 * Find config file location
 */
function getConfigPath(): string | null {
  // Check if custom path is provided
  const customPath = process.env.POLYBRAIN_CONFIG_PATH;
  if (customPath) {
    return customPath;
  }

  // Check project-local config
  const localPath = path.join(process.cwd(), ".polybrain.yaml");
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // Check user home config
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const homePath = path.join(homeDir, ".polybrain.yaml");
  if (fs.existsSync(homePath)) {
    return homePath;
  }

  return null;
}

/**
 * Load config from YAML file
 */
function loadConfigFile(): RawConfig | null {
  const configPath = getConfigPath();
  if (!configPath) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = yaml.load(content) as RawConfig;
    logger.debug("Loaded config from file", { configPath });
    return config;
  } catch (error) {
    logger.error(
      "Failed to load config file",
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

/**
 * Create a simple single-model config from environment variables
 */
function createSimpleConfig(): ServerConfig {
  const baseUrl = process.env.POLYBRAIN_BASE_URL;
  const apiKey = process.env.POLYBRAIN_API_KEY;
  const modelName = process.env.POLYBRAIN_MODEL_NAME;

  if (!baseUrl || !apiKey || !modelName) {
    throw new Error(
      "When using simple environment variable config, POLYBRAIN_BASE_URL, POLYBRAIN_API_KEY, and POLYBRAIN_MODEL_NAME must all be set"
    );
  }

  const httpPort = process.env.POLYBRAIN_HTTP_PORT
    ? Number(process.env.POLYBRAIN_HTTP_PORT)
    : 32701;
  const truncateLimit = process.env.POLYBRAIN_TRUNCATE_LIMIT
    ? Number(process.env.POLYBRAIN_TRUNCATE_LIMIT)
    : 500;
  const logLevel = (process.env.POLYBRAIN_LOG_LEVEL || "info") as LogLevel;

  logger.debug("Using simple environment variable config", { modelName });

  return {
    models: [
      {
        id: modelName, // Use modelName as ID in simple mode
        modelName,
        baseUrl,
        apiKey,
      },
    ],
    httpPort,
    truncateLimit,
    logLevel,
  };
}

/**
 * Parse and validate config from YAML file
 */
function parseYamlConfig(rawConfig: RawConfig): ServerConfig {
  const models = rawConfig.models as unknown[];
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("Config must have at least one model in the 'models' array");
  }

  const parsedModels: ModelConfig[] = models.map((model) => {
    if (typeof model !== "object" || model === null) {
      throw new Error("Each model must be an object");
    }

    const m = model as Record<string, unknown>;
    const id = m.id as string | undefined;
    const modelName = m.modelName as string | undefined;
    const baseUrl = m.baseUrl as string | undefined;
    const apiKey = m.apiKey as string | undefined;
    const provider = m.provider as string | undefined;

    if (!id) throw new Error("Model must have 'id' field");
    if (!modelName) throw new Error("Model must have 'modelName' field for API calls");
    if (!baseUrl) throw new Error("Model must have 'baseUrl' field");
    if (!apiKey) throw new Error("Model must have 'apiKey' field");

    // Validate provider if provided
    if (provider && !["openai", "openrouter"].includes(provider)) {
      throw new Error(`Invalid provider '${provider}'. Must be 'openai' or 'openrouter'`);
    }

    return {
      id,
      modelName,
      baseUrl,
      apiKey,
      provider: provider as "openai" | "openrouter" | undefined,
    };
  });

  const httpPort = rawConfig.httpPort ? Number(rawConfig.httpPort) : 32701;
  const truncateLimit = rawConfig.truncateLimit ? Number(rawConfig.truncateLimit) : 500;
  const logLevel = (rawConfig.logLevel || "info") as LogLevel;

  return {
    models: parsedModels,
    httpPort,
    truncateLimit,
    logLevel,
  };
}

/**
 * Load configuration with precedence:
 * 1. Simple env vars (POLYBRAIN_BASE_URL, POLYBRAIN_API_KEY, POLYBRAIN_MODEL_NAME)
 * 2. YAML config file
 * 3. Error if neither available
 */
export function loadConfig(): ServerConfig {
  // Check if simple env var config is complete
  const hasSimpleEnvConfig =
    process.env.POLYBRAIN_BASE_URL &&
    process.env.POLYBRAIN_API_KEY &&
    process.env.POLYBRAIN_MODEL_NAME;

  if (hasSimpleEnvConfig) {
    logger.info("Using simple environment variable configuration");
    return createSimpleConfig();
  }

  // Try to load YAML config
  const rawConfig = loadConfigFile();
  if (rawConfig) {
    logger.info("Using YAML configuration file");
    // Resolve env var references in config
    const resolvedConfig = resolveEnvVars(rawConfig) as RawConfig;
    return parseYamlConfig(resolvedConfig);
  }

  // No configuration found
  throw new Error(
    "No configuration found. Set POLYBRAIN_BASE_URL, POLYBRAIN_API_KEY, " +
      "and POLYBRAIN_MODEL_NAME environment variables, or create ~/.polybrain.yaml"
  );
}
