import OpenAI from "openai";
import { logger } from "./logger.js";
import type { ChatMessage } from "./types.js";

export interface ChatOptions {
  reasoning?: boolean;
  provider?: "openai" | "openrouter";
}

export class OpenAIClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.openai.com/v1") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Build provider-specific reasoning parameters
   */
  private buildReasoningParams(
    provider: string | undefined,
    enabled: boolean
  ): Record<string, unknown> {
    if (!enabled || !provider) {
      return {};
    }

    switch (provider) {
      case "openai":
        return { reasoning: { enabled: true } };
      case "openrouter":
        // OpenRouter reasoning support varies by model
        // Many models don't support reasoning parameters, so return empty
        // User should check OpenRouter docs for specific model support
        logger.debug("Reasoning requested for OpenRouter model - not all models support this");
        return {};
      default:
        return {};
    }
  }

  /**
   * Extract reasoning from various response field formats
   */
  private extractReasoning(message: Record<string, unknown>): string | undefined {
    // Try different field names used by different providers
    const reasoning =
      (message.reasoning as string | undefined) ||
      (message.thinking as string | undefined) ||
      (message.reasoning_content as string | undefined);

    if (reasoning) {
      return reasoning;
    }

    // Handle reasoning_details array format
    const reasoningDetails = message.reasoning_details as Array<{ text: string }> | undefined;
    if (reasoningDetails && Array.isArray(reasoningDetails) && reasoningDetails.length > 0) {
      return reasoningDetails.map((block) => block.text).join("\n");
    }

    return undefined;
  }

  /**
   * Create a client instance with the stored credentials
   */
  private getClient(): OpenAI {
    return new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    });
  }

  /**
   * Send a chat message and get a response
   */
  async chat(
    modelId: string,
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<{ content: string; reasoning?: string }> {
    try {
      logger.debug("Sending chat request to OpenAI", {
        model: modelId,
        messageCount: messages.length,
        reasoning: options?.reasoning,
      });

      const openaiMessages = messages.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      }));

      const client = this.getClient();

      // Build provider-specific reasoning params
      const reasoningParams = this.buildReasoningParams(
        options?.provider,
        options?.reasoning ?? false
      );

      const response = await client.chat.completions.create({
        model: modelId,
        messages: openaiMessages,
        ...reasoningParams,
      });

      const textContent = response.choices[0]?.message?.content;
      if (!textContent) {
        throw new Error("No content in response from OpenAI");
      }

      logger.debug("Received response from OpenAI", {
        model: modelId,
        tokens: response.usage?.total_tokens,
      });

      // Extract reasoning if present and requested
      let reasoning: string | undefined;
      if (options?.reasoning) {
        reasoning = this.extractReasoning(response.choices[0].message as Record<string, unknown>);
      }

      return {
        content: textContent,
        reasoning,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("OpenAI API error", {
        model: modelId,
        error: errorMessage,
      });

      throw new Error(`Failed to get response from OpenAI: ${errorMessage}`);
    }
  }

  /**
   * Validate that a model is accessible
   */
  async validateModel(modelId: string): Promise<boolean> {
    try {
      logger.debug("Validating model", { model: modelId });

      // Try a minimal request to validate the model
      const client = this.getClient();
      await client.chat.completions.create({
        model: modelId,
        messages: [{ role: "user" as const, content: "" }],
        max_tokens: 1,
      });

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("Model validation failed", {
        model: modelId,
        error: errorMessage,
      });

      return false;
    }
  }
}
