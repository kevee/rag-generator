import { useCallback, useRef, useState } from "react";
import type { ChatMessageInput, CitationEvent, Source } from "@rag-generator/shared";
import { streamChat } from "./api";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  citations: CitationEvent[];
  citedSources: number[];
  status: "streaming" | "done" | "error";
  error?: string;
}

let counter = 0;
const nextId = () => `${Date.now().toString(36)}-${counter++}`;

export function useChat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const update = useCallback((id: string, patch: (m: UiMessage) => UiMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || abortRef.current) return;

      const userMsg: UiMessage = { id: nextId(), role: "user", content, sources: [], citations: [], citedSources: [], status: "done" };
      const assistantId = nextId();
      const assistantMsg: UiMessage = { id: assistantId, role: "assistant", content: "", sources: [], citations: [], citedSources: [], status: "streaming" };

      const history: ChatMessageInput[] = [...messages, userMsg]
        .filter((m) => m.status !== "error" && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        for await (const event of streamChat(history, controller.signal)) {
          switch (event.type) {
            case "sources":
              update(assistantId, (m) => ({ ...m, sources: event.sources }));
              break;
            case "delta":
              update(assistantId, (m) => ({ ...m, content: m.content + event.text }));
              break;
            case "citation":
              update(assistantId, (m) => ({ ...m, citations: [...m.citations, event.citation] }));
              break;
            case "done":
              update(assistantId, (m) => ({ ...m, status: "done", citedSources: event.citedSources }));
              break;
            case "error":
              update(assistantId, (m) => ({ ...m, status: "error", error: event.message }));
              break;
          }
        }
        update(assistantId, (m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
      } catch (err) {
        if (controller.signal.aborted) {
          update(assistantId, (m) => ({ ...m, status: "done" }));
        } else {
          update(assistantId, (m) => ({ ...m, status: "error", error: err instanceof Error ? err.message : String(err) }));
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [messages, update],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, send, stop, reset, isStreaming };
}
