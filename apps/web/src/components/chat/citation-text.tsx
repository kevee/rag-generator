import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CitationEvent, Source } from "@rag-generator/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const CITE_PREFIX = "#cite-";

/** Insert `[n](#cite-n)` markers into the raw markdown at each citation's position, back to front. */
function withCitationMarkers(text: string, citations: CitationEvent[]): string {
  if (citations.length === 0) return text;
  // Group by position; keep one marker per source number per position.
  const byPos = new Map<number, number[]>();
  for (const c of citations) {
    let pos = Math.min(Math.max(c.position, 0), text.length);
    // Cited spans often end with a newline; attach the chip to the end of the sentence, not the next line.
    while (pos > 0 && /\s/.test(text[pos - 1]!)) pos--;
    const list = byPos.get(pos) ?? [];
    if (!list.includes(c.n)) list.push(c.n);
    byPos.set(pos, list);
  }
  const positions = [...byPos.keys()].sort((a, b) => b - a);
  let out = text;
  for (const pos of positions) {
    const markers = byPos.get(pos)!.map((n) => `[${n}](${CITE_PREFIX}${n})`).join("");
    out = out.slice(0, pos) + markers + out.slice(pos);
  }
  return out;
}

export function CitationText({
  text,
  citations,
  sources,
  activeSource,
  onHoverSource,
}: {
  text: string;
  citations: CitationEvent[];
  sources: Source[];
  activeSource: number | null;
  onHoverSource: (n: number | null) => void;
}) {
  const marked = withCitationMarkers(text, citations);
  return (
    <div className="prose-chat text-[15px]">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            if (href?.startsWith(CITE_PREFIX)) {
              const n = Number(href.slice(CITE_PREFIX.length));
              const source = sources.find((s) => s.n === n);
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={source?.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      onMouseEnter={() => onHoverSource(n)}
                      onMouseLeave={() => onHoverSource(null)}
                      className={cn(
                        "mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full border px-1 align-text-top text-[0.65rem] font-semibold no-underline transition-colors",
                        activeSource === n ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-secondary-foreground hover:bg-accent",
                      )}
                    >
                      {n}
                    </a>
                  </TooltipTrigger>
                  {source && (
                    <TooltipContent>
                      <div className="font-medium">{source.title}</div>
                      {source.headings[0] && <div className="opacity-80">{source.headings[0]}</div>}
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {marked}
      </Markdown>
    </div>
  );
}
