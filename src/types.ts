export interface ModelConfig {
  id: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
}

export interface ServerConfig {
  models: ModelConfig[];
  truncateLimit?: number;
  httpPort?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ConversationState {
  id: string;
  modelId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  modelId?: string;
  reasoning?: boolean;
}

export interface ChatResponse {
  conversationId: string;
  response: string;
  reasoning?: string;
  modelId: string;
}

export interface ConversationHistoryResponse {
  conversationId: string;
  modelId: string;
  messages: ChatMessage[];
}

export interface ModelInfo {
  id: string;
  modelName: string;
  baseUrl: string;
}
