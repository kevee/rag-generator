import type { ChatMessageInput, ChatStreamEvent, PublicConfig } from "@rag-generator/shared";

export async function fetchConfig(): Promise<PublicConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`config request failed (${res.status})`);
  return (await res.json()) as PublicConfig;
}

/**
 * POST the conversation and yield typed events parsed from the SSE body.
 * EventSource is GET-only, so we read the ReadableStream and split frames by hand.
 */
export async function* streamChat(messages: ChatMessageInput[], signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    yield { type: "error", code: "upstream", message: `Request failed (${res.status}). ${detail}`.trim() };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        yield JSON.parse(data) as ChatStreamEvent;
      } catch {
        // ignore malformed frame
      }
    }
  }
}
