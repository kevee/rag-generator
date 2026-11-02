import Anthropic from "@anthropic-ai/sdk";
import type { AssistantConfig, ChatMessageInput, ChatStreamEvent } from "@rag-generator/shared";
import { env } from "./env.js";
import { buildSystemPrompt, buildUserTurn, groupSources } from "./prompt.js";
import { indexExists, retrieve } from "./retrieve.js";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const MAX_HISTORY = 12;
const MAX_MESSAGE_CHARS = 2000;

export interface ChatRunOptions {
  signal?: AbortSignal;
}

/**
 * Run one chat turn: retrieve, prompt, stream. Yields UI events; the caller
 * serializes them as SSE. Errors are yielded as events, not thrown, so the
 * stream always ends cleanly.
 */
export async function* runChat(
  assistant: AssistantConfig,
  history: ChatMessageInput[],
  options: ChatRunOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  const trimmed = history.slice(-MAX_HISTORY).map((m) => ({ ...m, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  const last = trimmed[trimmed.length - 1];
  if (!last || last.role !== "user" || !last.content.trim()) {
    yield { type: "error", code: "bad_request", message: "The last message must be from the user." };
    return;
  }

  if (!indexExists()) {
    yield {
      type: "error",
      code: "no_index",
      message: "The search index has not been built yet. Run `pnpm crawl` and `pnpm index` first.",
    };
    return;
  }

  let chunks;
  try {
    chunks = await retrieve(last.content);
  } catch (err) {
    yield { type: "error", code: "upstream", message: `Retrieval failed: ${err instanceof Error ? err.message : String(err)}` };
    return;
  }

  const { sources, chunkToSource } = groupSources(chunks);
  yield { type: "sources", sources };

  // Prior turns go in as plain text; only the current turn carries documents.
  const messages: Anthropic.MessageParam[] = [
    ...trimmed.slice(0, -1).map((m): Anthropic.MessageParam => ({ role: m.role, content: m.content })),
    buildUserTurn(last.content, chunks, chunkToSource),
  ];

  // document_index in citations is the position among document blocks in the current turn,
  // which is the same order as `chunks`.
  const docIndexToSource = (i: number): number | undefined => {
    const chunk = chunks[i];
    return chunk ? chunkToSource.get(chunk.chunkId) : undefined;
  };

  const stream = getClient().messages.stream(
    {
      model: env.model,
      max_tokens: env.maxTokens,
      system: [{ type: "text", text: buildSystemPrompt(assistant), cache_control: { type: "ephemeral" } }],
      output_config: { effort: env.effort },
      messages,
    },
    { signal: options.signal },
  );

  let position = 0;
  const cited = new Set<number>();

  try {
    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta") {
        position += event.delta.text.length;
        yield { type: "delta", text: event.delta.text };
      } else if (event.delta.type === "citations_delta") {
        const c = event.delta.citation;
        const n = "document_index" in c ? docIndexToSource(c.document_index) : undefined;
        if (n !== undefined) {
          cited.add(n);
          yield { type: "citation", citation: { n, citedText: c.cited_text, position } };
        }
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      yield {
        type: "error",
        code: "refusal",
        message: assistant.copy.refusal,
      };
      return;
    }
    yield {
      type: "done",
      citedSources: [...cited].sort((a, b) => a - b),
      usage: {
        input: final.usage.input_tokens,
        output: final.usage.output_tokens,
        cacheRead: final.usage.cache_read_input_tokens ?? 0,
        cacheWrite: final.usage.cache_creation_input_tokens ?? 0,
      },
    };
  } catch (err) {
    if (options.signal?.aborted) return;
    if (err instanceof Anthropic.RateLimitError) {
      yield { type: "error", code: "rate_limited", message: "The assistant is busy right now. Please try again in a moment." };
    } else if (err instanceof Anthropic.AuthenticationError) {
      yield { type: "error", code: "upstream", message: "The server's Claude API key is missing or invalid (ANTHROPIC_API_KEY)." };
    } else if (err instanceof Anthropic.APIError) {
      yield { type: "error", code: "upstream", message: `Claude API error ${err.status ?? ""}: ${err.message}` };
    } else {
      yield { type: "error", code: "upstream", message: err instanceof Error ? err.message : String(err) };
    }
  }
}
