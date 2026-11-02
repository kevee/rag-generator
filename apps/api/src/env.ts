import { embedderProvider, loadEnv } from "@rag-generator/retrieval";

loadEnv();

export const env = {
  port: Number(process.env.PORT ?? 8787),
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  /**
   * Chat is a conversational workload; low effort keeps latency down.
   * Named CHAT_EFFORT because Claude Code exports CLAUDE_EFFORT into its shells, which silently overrode this.
   */
  effort: (process.env.CHAT_EFFORT ?? "low") as "low" | "medium" | "high",
  maxTokens: Number(process.env.CLAUDE_MAX_TOKENS ?? 4096),
  retrievalK: Number(process.env.RETRIEVAL_K ?? 8),
  hasAnthropicCredentials: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  embedder: embedderProvider(),
  hasVoyageKey: Boolean(process.env.VOYAGE_API_KEY),
};
