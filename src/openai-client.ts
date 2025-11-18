import OpenAI from "openai";
import { logger } from "./logger.js";
import type { ChatMessage } from "./types.js";

export interface ChatOptions {
  reasoning?: boolean;
}

export class OpenAIClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.openai.com/v1") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
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
      const response = await client.chat.completions.create({
        model: modelId,
        messages: openaiMessages,
        ...(options?.reasoning && { reasoning: "enabled" }),
      });

      const textContent = response.choices[0]?.message?.content;
      if (!textContent) {
        throw new Error("No content in response from OpenAI");
      }

      logger.debug("Received response from OpenAI", {
        model: modelId,
        tokens: response.usage?.total_tokens,
      });

      // Handle reasoning if present in response
      let reasoning: string | undefined;
      if (
        options?.reasoning &&
        (response.choices[0].message as Record<string, unknown>).reasoning
      ) {
        reasoning = String((response.choices[0].message as Record<string, unknown>).reasoning);
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
