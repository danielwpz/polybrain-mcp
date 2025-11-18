import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import type { ChatMessage, ConversationState } from "./types.js";

export class ConversationManager {
  private conversations: Map<string, ConversationState> = new Map();
  private truncateLimit: number;

  constructor(truncateLimit = 500) {
    this.truncateLimit = truncateLimit;
  }

  /**
   * Create a new conversation or get existing one
   */
  createConversation(modelId: string): string {
    const conversationId = randomUUID();
    const conversation: ConversationState = {
      id: conversationId,
      modelId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.conversations.set(conversationId, conversation);
    logger.debug("Created new conversation", { conversationId, modelId });

    return conversationId;
  }

  /**
   * Get a conversation by ID
   */
  getConversation(conversationId: string): ConversationState | null {
    return this.conversations.get(conversationId) || null;
  }

  /**
   * Add a message to a conversation
   */
  addMessage(conversationId: string, role: "user" | "assistant", content: string): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    conversation.messages.push({ role, content });
    conversation.updatedAt = Date.now();

    logger.debug("Added message to conversation", {
      conversationId,
      role,
      contentLength: content.length,
    });
  }

  /**
   * Get conversation history with optional truncation
   */
  getHistory(conversationId: string): ChatMessage[] {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    return this.truncateMessages(conversation.messages);
  }

  /**
   * Clone a conversation with a new model
   */
  cloneConversation(sourceConversationId: string, newModelId: string): string {
    const source = this.conversations.get(sourceConversationId);
    if (!source) {
      throw new Error(`Source conversation not found: ${sourceConversationId}`);
    }

    const newConversationId = this.createConversation(newModelId);
    const newConversation = this.conversations.get(newConversationId);

    if (!newConversation) {
      throw new Error("Failed to create cloned conversation");
    }

    // Copy messages from source
    newConversation.messages = source.messages.map((msg) => ({ ...msg }));
    newConversation.updatedAt = Date.now();

    logger.info("Cloned conversation with new model", {
      sourceConversationId,
      newConversationId,
      oldModelId: source.modelId,
      newModelId,
      messageCount: source.messages.length,
    });

    return newConversationId;
  }

  /**
   * Get full conversation state
   */
  getConversationState(conversationId: string): ConversationState | null {
    return this.getConversation(conversationId);
  }

  /**
   * Truncate messages to limit context size
   * Keeps first N and last N messages if total exceeds limit
   */
  private truncateMessages(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length <= this.truncateLimit) {
      return messages;
    }

    const kept = Math.floor(this.truncateLimit / 2);
    const first = messages.slice(0, kept);
    const last = messages.slice(-kept);

    // Add marker for truncated content
    const marker: ChatMessage = {
      role: "assistant",
      content: "[... conversation history truncated to save context ...]",
    };

    return [...first, marker, ...last];
  }
}
