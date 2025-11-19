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
      title: "Chat with Another LLM Model",
      description:
        'Send a message to an available LLM for help, second opinions, or brainstorming; start new conversations, continue existing ones, or switch models mid-chat.\n\nExample workflow:\n1. chat(message: "hello", modelId: "gpt-5-mini") → conversationId: "abc1"\n2. chat(message: "follow-up", conversationId: "abc1") → conversationId: "abc1" (continues)\n3. chat(message: "same question", conversationId: "abc1", modelId: "deepseek-r1") → conversationId: "xyz9" (cloned with new model)',
      inputSchema: z.object({
        message: z.string().describe("The question or request to send—be clear and specific."),
        conversationId: z
          .string()
          .optional()
          .describe(
            "ID of the conversation to continue; omit to start a new one. Use the conversationId from prior responses to keep discussing the same topic."
          ),
        modelId: z
          .string()
          .optional()
          .describe(
            "ID of model to use (call list_models); omitted = default model. To switch models, pass a different modelId with your conversationId — you'll get a new conversationId with the conversation cloned to the new model."
          ),
        reasoning: z
          .boolean()
          .optional()
          .describe(
            "Set true to have the model show its reasoning steps, useful for complex problems."
          ),
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

        // Validate model exists and get its full model name
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

        // Get the full model name from config for API calls
        const modelConfig = config.models.find((m) => m.id === actualModelId);
        if (!modelConfig) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Model configuration not found: ${actualModelId}`,
              },
            ],
          };
        }

        // Add user message to conversation
        conversationManager.addMessage(actualConversationId, "user", message);

        // Get conversation history
        const history = conversationManager.getHistory(actualConversationId);

        // Send to OpenAI - use the full modelName for the API call
        const response = await client.chat(modelConfig.modelName, history, {
          reasoning,
          provider: modelConfig.provider,
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
      title: "See Available Models to Talk To",
      description:
        "Get all the models you can chat with. Each model has different strengths and expertise. Call this first to see which model is best for your question, or to find a specific model ID to use in the chat tool.",
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
      title: "Review Your Conversation with Another Model",
      description:
        "See what you've already discussed with a specific model. Useful for understanding context before continuing a conversation, reviewing advice you got, or checking previous responses. Long conversations are automatically shortened to save context.",
      inputSchema: z.object({
        conversationId: z
          .string()
          .describe(
            "The ID of the conversation you want to review. Get this from the response of the chat tool when you first talk to a model."
          ),
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
