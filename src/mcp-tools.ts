import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConversationManager } from "./conversation-manager.js";
import { logger } from "./logger.js";
import type { OpenAIClient } from "./openai-client.js";
import type { ModelInfo, ServerConfig } from "./types.js";

export function registerTools(
  server: McpServer,
  conversationManager: ConversationManager,
  openaiClients: Map<string, OpenAIClient>,
  config: ServerConfig
): void {
  // Chat tool
  server.registerTool(
    "chat",
    {
      title: "Chat with LLM",
      description:
        "Send a message to an LLM model. Can create new conversation, continue existing one, or clone to new model.",
      inputSchema: z.object({
        message: z.string().describe("The message to send"),
        conversationId: z.string().optional().describe("ID of existing conversation to continue"),
        modelId: z.string().optional().describe("ID of model to use"),
        reasoning: z.boolean().optional().describe("Whether to include reasoning"),
      }),
    },
    async ({ message, conversationId, modelId, reasoning }) => {
      try {
        logger.debug("Chat tool called", {
          hasConversationId: !!conversationId,
          modelId,
        });

        let actualConversationId: string;
        let actualModelId: string;

        // Determine conversation ID and model ID
        if (conversationId) {
          const existing = conversationManager.getConversation(conversationId);
          if (!existing) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Conversation not found: ${conversationId}`,
                },
              ],
            };
          }

          if (modelId && modelId !== existing.modelId) {
            // Clone conversation with new model
            actualConversationId = conversationManager.cloneConversation(conversationId, modelId);
            actualModelId = modelId;
          } else {
            // Continue existing conversation
            actualConversationId = conversationId;
            actualModelId = existing.modelId;
          }
        } else {
          // Create new conversation
          actualModelId = modelId || config.models[0].id;
          actualConversationId = conversationManager.createConversation(actualModelId);
        }

        // Validate model exists
        const client = openaiClients.get(actualModelId);
        if (!client) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Model not configured: ${actualModelId}`,
              },
            ],
          };
        }

        // Add user message to conversation
        conversationManager.addMessage(actualConversationId, "user", message);

        // Get conversation history
        const history = conversationManager.getHistory(actualConversationId);

        // Send to OpenAI
        const response = await client.chat(actualModelId, history, {
          reasoning,
        });

        // Add assistant response to conversation
        conversationManager.addMessage(actualConversationId, "assistant", response.content);

        logger.info("Chat completed", {
          conversationId: actualConversationId,
          modelId: actualModelId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                conversationId: actualConversationId,
                response: response.content,
                reasoning: response.reasoning,
                modelId: actualModelId,
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Chat tool error", error instanceof Error ? error : new Error(errorMessage));

        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  // List models tool
  server.registerTool(
    "list_models",
    {
      title: "List Available Models",
      description: "Get list of all available LLM models",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const models: ModelInfo[] = config.models.map((m) => ({
          id: m.id,
          modelName: m.modelName,
          baseUrl: m.baseUrl,
        }));

        logger.debug("Listed models", { count: models.length });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                models,
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          "List models tool error",
          error instanceof Error ? error : new Error(errorMessage)
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  // Conversation history tool
  server.registerTool(
    "conversation_history",
    {
      title: "Get Conversation History",
      description:
        "Get the message history of a conversation. Long messages are truncated to save context.",
      inputSchema: z.object({
        conversationId: z.string().describe("ID of conversation"),
      }),
    },
    async ({ conversationId }) => {
      try {
        const conversation = conversationManager.getConversationState(conversationId);
        if (!conversation) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Conversation not found: ${conversationId}`,
              },
            ],
          };
        }

        const history = conversationManager.getHistory(conversationId);

        logger.debug("Retrieved conversation history", {
          conversationId,
          messageCount: history.length,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                conversationId,
                modelId: conversation.modelId,
                messages: history,
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          "Conversation history tool error",
          error instanceof Error ? error : new Error(errorMessage)
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );
}
