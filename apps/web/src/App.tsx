import { useEffect, useState } from "react";
import { Info, RotateCcw, TriangleAlert } from "lucide-react";
import type { PublicConfig, QuickAction } from "@rag-generator/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Composer } from "@/components/chat/composer";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageList } from "@/components/chat/message-list";
import { QuickActions } from "@/components/chat/quick-actions";
import { fetchConfig } from "@/lib/api";
import { useChat } from "@/lib/use-chat";

export default function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const { messages, send, stop, reset, isStreaming } = useChat();

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch((err: unknown) => setConfigError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (config) document.title = config.assistantName;
  }, [config]);

  const indexMissing = config !== null && config.index === null;
  const disabled = config === null || indexMissing;
  const onQuickAction = (a: QuickAction) => void send(a.prompt);

  return (
    <TooltipProvider>
      <div className="flex h-dvh flex-col">
        <header className="bg-background/90 sticky top-0 z-10 border-b backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">{config?.assistantName ?? "Assistant"}</span>
                <Badge variant="accent">Unofficial</Badge>
              </div>
              <div className="text-muted-foreground truncate text-xs">
                Answers drawn only from{" "}
                <a href={config?.contact.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {config?.contact.name ?? "the official site"}
                </a>
              </div>
            </div>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={reset} aria-label="Start a new conversation">
                <RotateCcw /> New chat
              </Button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {configError && (
            <div className="mx-auto w-full max-w-3xl px-4 pt-4">
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Can't reach the API</AlertTitle>
                <AlertDescription>
                  <p>{configError}. Is the API server running on port 8787?</p>
                </AlertDescription>
              </Alert>
            </div>
          )}
          {indexMissing && (
            <div className="mx-auto w-full max-w-3xl px-4 pt-4">
              <Alert variant="info">
                <Info />
                <AlertTitle>The search index hasn't been built yet</AlertTitle>
                <AlertDescription>
                  <p>
                    Run <code className="bg-muted rounded px-1">pnpm crawl</code> and <code className="bg-muted rounded px-1">pnpm index</code>, then reload.
                  </p>
                </AlertDescription>
              </Alert>
            </div>
          )}
          {config && messages.length === 0 && <EmptyState config={config} onQuickAction={onQuickAction} onSuggestion={(q) => void send(q)} disabled={disabled} />}
          {messages.length > 0 && <MessageList messages={messages} />}
        </main>

        <footer className="bg-background/95 border-t backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3">
            {config && messages.length > 0 && <QuickActions actions={config.quickActions} onSelect={onQuickAction} compact disabled={disabled || isStreaming} />}
            <Composer onSend={(t) => void send(t)} onStop={stop} isStreaming={isStreaming} disabled={disabled} placeholder={config?.copy.placeholder} />
            <p className="text-muted-foreground text-center text-[11px] leading-snug">
              {config?.copy.disclaimer ?? "This assistant can make mistakes."} Confirm details with{" "}
              <a href={config?.contact.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {config?.contact.name ?? "the official site"}
              </a>
              {config?.contact.phone ? ` at ${config.contact.phone}` : ""}.
              {config?.index?.lastCrawl ? ` Content last updated ${new Date(config.index.lastCrawl).toLocaleDateString()}.` : ""}
            </p>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
