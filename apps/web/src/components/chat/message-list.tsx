import { useEffect, useRef, useState } from "react";
import { AlertCircle, Bot } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { UiMessage } from "@/lib/use-chat";
import { CitationText } from "./citation-text";
import { SourceCards } from "./source-cards";

function AssistantMessage({ message }: { message: UiMessage }) {
  const [active, setActive] = useState<number | null>(null);
  const waiting = message.status === "streaming" && message.content.length === 0;
  return (
    <div className="flex gap-3">
      <div className="bg-primary text-primary-foreground mt-1 flex size-7 shrink-0 items-center justify-center rounded-full">
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        {waiting ? (
          <div className="space-y-2 pt-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <CitationText text={message.content} citations={message.citations} sources={message.sources} activeSource={active} onHoverSource={setActive} />
        )}
        {message.status === "error" && (
          <Alert variant="destructive" className="mt-2">
            <AlertCircle />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{message.error}</AlertDescription>
          </Alert>
        )}
        {message.status !== "error" && <SourceCards sources={message.sources} citedSources={message.citedSources} activeSource={active} onHoverSource={setActive} />}
      </div>
    </div>
  );
}

export function MessageList({ messages }: { messages: UiMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastContent = messages[messages.length - 1]?.content.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, lastContent]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className={cn("bg-secondary text-secondary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-[15px] whitespace-pre-wrap")}>{m.content}</div>
          </div>
        ) : (
          <AssistantMessage key={m.id} message={m} />
        ),
      )}
      <div ref={bottomRef} />
    </div>
  );
}
