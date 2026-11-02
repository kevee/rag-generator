import { useState } from "react";
import { ExternalLink, FileText, Globe } from "lucide-react";
import type { Source } from "@rag-generator/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function SourceCards({
  sources,
  citedSources,
  activeSource,
  onHoverSource,
}: {
  sources: Source[];
  citedSources: number[];
  activeSource: number | null;
  onHoverSource: (n: number | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (sources.length === 0) return null;
  const citedSet = new Set(citedSources);
  const cited = sources.filter((s) => citedSet.has(s.n));
  const uncited = sources.filter((s) => !citedSet.has(s.n));
  // Before citations arrive (or when there are none) show everything.
  const visible = cited.length === 0 || showAll ? sources : cited;

  return (
    <div className="mt-3 space-y-2">
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Sources</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {visible.map((s) => (
          <a
            key={s.n}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            onMouseEnter={() => onHoverSource(s.n)}
            onMouseLeave={() => onHoverSource(null)}
            className={cn(
              "bg-card group flex gap-2.5 rounded-lg border p-2.5 text-left text-sm transition-colors hover:bg-accent/60",
              activeSource === s.n && "border-primary ring-primary/30 ring-2",
            )}
          >
            <Badge variant={citedSet.has(s.n) ? "default" : "secondary"} className="mt-0.5 h-5 min-w-5 rounded-full px-1.5">
              {s.n}
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-1.5">
                {s.kind === "pdf" ? <FileText className="text-muted-foreground mt-0.5 size-3.5 shrink-0" /> : <Globe className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />}
                <span className="line-clamp-2 font-medium leading-snug">{s.title}</span>
                <ExternalLink className="text-muted-foreground ml-auto size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              {s.headings[0] && <div className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">{s.headings[0]}</div>}
              <div className="text-muted-foreground mt-1 text-[11px]">
                {s.archiveUrl ? "Archived snapshot" : "Fetched"} {formatDate(s.fetchedAt)}
                {s.archiveUrl && (
                  <>
                    {" · "}
                    <a href={s.archiveUrl} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>
                      view capture
                    </a>
                  </>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
      {cited.length > 0 && uncited.length > 0 && (
        <Button variant="ghost" size="sm" className="text-muted-foreground h-7 px-2 text-xs" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show cited only" : `Show ${uncited.length} more retrieved source${uncited.length === 1 ? "" : "s"}`}
        </Button>
      )}
    </div>
  );
}
