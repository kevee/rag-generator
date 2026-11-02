import { createHash } from "node:crypto";

export interface ChunkOptions {
  /** Target max tokens per chunk (estimated). */
  maxTokens?: number;
  /** Tokens of trailing context carried into the next chunk. */
  overlapTokens?: number;
  /** Chunks smaller than this are merged into a neighbor. */
  minTokens?: number;
}

export interface MarkdownChunk {
  ordinal: number;
  /** Heading path, e.g. "Vote by Mail > Deadlines". Empty string for preamble. */
  heading: string;
  text: string;
  tokenCount: number;
  contentHash: string;
}

/** Cheap token estimate: ~4 characters per token for English prose. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

interface Section {
  heading: string;
  paragraphs: string[];
}

/** Split markdown into sections keyed by heading path (H1 to H3). */
function splitSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  const stack: string[] = [];
  let current: Section = { heading: "", paragraphs: [] };
  let buffer: string[] = [];

  const flushParagraph = () => {
    const para = buffer.join("\n").trim();
    if (para) current.paragraphs.push(para);
    buffer = [];
  };
  const flushSection = () => {
    flushParagraph();
    if (current.paragraphs.length > 0) sections.push(current);
  };

  for (const line of lines) {
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      flushSection();
      const level = m[1]!.length;
      stack.length = level - 1;
      stack[level - 1] = m[2]!.trim();
      current = { heading: stack.filter(Boolean).join(" > "), paragraphs: [] };
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
    } else {
      buffer.push(line);
    }
  }
  flushSection();
  return sections;
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  // Tables and lists: split on lines. Prose: split on sentence boundaries.
  const isBlock = /^\s*([-*|]|\d+\.)/m.test(paragraph);
  const units = isBlock ? paragraph.split(/\n/) : paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    const candidate = cur ? cur + (isBlock ? "\n" : " ") + u : u;
    if (candidate.length > maxChars && cur) {
      out.push(cur);
      cur = u;
    } else {
      cur = candidate;
    }
  }
  if (cur) out.push(cur);
  // Hard split anything still too long (e.g. a giant table row).
  return out.flatMap((s) => (s.length <= maxChars ? [s] : s.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, "g")) ?? []));
}

/**
 * Heading-aware chunker. Keeps sections together when they fit, otherwise packs
 * paragraphs up to maxTokens with a small trailing overlap so facts that straddle
 * a boundary still land in one chunk.
 */
export function chunkMarkdown(markdown: string, options: ChunkOptions = {}): MarkdownChunk[] {
  const maxTokens = options.maxTokens ?? 600;
  const overlapTokens = options.overlapTokens ?? 80;
  const minTokens = options.minTokens ?? 40;
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;

  const chunks: { heading: string; text: string }[] = [];

  for (const section of splitSections(markdown)) {
    const paragraphs = section.paragraphs.flatMap((p) => splitLongParagraph(p, maxChars));
    let current: string[] = [];
    let currentLen = 0;

    const emit = () => {
      if (current.length === 0) return;
      chunks.push({ heading: section.heading, text: current.join("\n\n") });
    };

    for (const para of paragraphs) {
      if (currentLen + para.length + 2 > maxChars && current.length > 0) {
        emit();
        // Carry trailing paragraphs as overlap.
        const carry: string[] = [];
        let carryLen = 0;
        for (let i = current.length - 1; i >= 0 && carryLen + current[i]!.length <= overlapChars; i--) {
          carry.unshift(current[i]!);
          carryLen += current[i]!.length;
        }
        current = carry;
        currentLen = carryLen;
      }
      current.push(para);
      currentLen += para.length + 2;
    }
    emit();
  }

  // Merge tiny chunks into their predecessor when they share a heading.
  const merged: { heading: string; text: string }[] = [];
  for (const c of chunks) {
    const prev = merged[merged.length - 1];
    if (prev && estimateTokens(c.text) < minTokens && estimateTokens(prev.text + c.text) <= maxTokens * 1.2) {
      prev.text = prev.text + "\n\n" + c.text;
      if (!prev.heading && c.heading) prev.heading = c.heading;
    } else {
      merged.push({ ...c });
    }
  }

  return merged.map((c, i) => ({
    ordinal: i,
    heading: c.heading,
    text: c.text,
    tokenCount: estimateTokens(c.text),
    contentHash: sha256(c.heading + "\n" + c.text),
  }));
}
