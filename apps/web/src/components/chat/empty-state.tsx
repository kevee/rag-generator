import type { PublicConfig, QuickAction } from "@rag-generator/shared";
import { Button } from "@/components/ui/button";
import { QuickActions } from "./quick-actions";

export function EmptyState({ config, onQuickAction, onSuggestion, disabled }: { config: PublicConfig; onQuickAction: (a: QuickAction) => void; onSuggestion: (q: string) => void; disabled?: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{config.copy.headline}</h1>
        <p className="text-muted-foreground mt-2 max-w-prose text-[15px]">{config.copy.intro}</p>
      </div>
      <section aria-labelledby="quick-actions-heading" className="space-y-3">
        <h2 id="quick-actions-heading" className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Common tasks
        </h2>
        <QuickActions actions={config.quickActions} onSelect={onQuickAction} compact={false} disabled={disabled} />
      </section>
      {config.suggestedQuestions.length > 0 && (
        <section aria-labelledby="suggestions-heading" className="space-y-3">
          <h2 id="suggestions-heading" className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Or try asking
          </h2>
          <div className="flex flex-wrap gap-2">
            {config.suggestedQuestions.map((q) => (
              <Button key={q} variant="secondary" size="sm" disabled={disabled} onClick={() => onSuggestion(q)} className="h-auto rounded-full px-3 py-1.5 text-left whitespace-normal">
                {q}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
