/** Browser-safe types shared by the crawler, API, and web app. No Node imports here. */

export type DocumentKind = "html" | "pdf";

/** A crawled page or PDF, as stored in the index. */
export interface SourceDocument {
  id: number;
  url: string;
  title: string;
  kind: DocumentKind;
  fetchedAt: string;
  contentHash: string;
  /** Internet Archive capture this document came from, when not fetched live. */
  archiveUrl?: string;
}

/** A chunk of a document with its retrieval scores. */
export interface RetrievedChunk {
  chunkId: number;
  documentId: number;
  url: string;
  title: string;
  kind: DocumentKind;
  heading: string;
  text: string;
  fetchedAt: string;
  archiveUrl?: string;
  /** Reciprocal-rank-fusion score (higher is better). */
  score: number;
  vectorRank?: number;
  keywordRank?: number;
}

/** A numbered source shown in the UI. One per page; may aggregate several chunks. */
export interface Source {
  /** 1-based number used in [n] citation markers. */
  n: number;
  url: string;
  title: string;
  kind: DocumentKind;
  headings: string[];
  snippet: string;
  fetchedAt: string;
  archiveUrl?: string;
}

export interface ChatMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessageInput[];
}

/** A citation emitted by Claude, mapped from a document block to a numbered source. */
export interface CitationEvent {
  /** 1-based source number this citation points to. */
  n: number;
  /** The text Claude cited from the source. */
  citedText: string;
  /** Character offset in the assistant text where the citation attaches. */
  position: number;
}

export type ChatStreamEvent =
  | { type: "sources"; sources: Source[] }
  | { type: "delta"; text: string }
  | { type: "citation"; citation: CitationEvent }
  | {
      type: "done";
      citedSources: number[];
      usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
    }
  | {
      type: "error";
      code: "refusal" | "rate_limited" | "upstream" | "bad_request" | "no_index";
      message: string;
    };

/** One-click key path shown as a button in the UI. */
export interface QuickAction {
  id: string;
  label: string;
  /** lucide icon name */
  icon: string;
  /** The question sent to the assistant when clicked. */
  prompt: string;
  /** Official page for this task, if one exists. Also used as a crawl seed. */
  href?: string;
}

/** Where people are sent when the sources do not answer. */
export interface ContactInfo {
  name: string;
  url: string;
  phone?: string;
  email?: string;
  address?: string;
}

/** User-facing copy that names the organization or domain. Everything else in the UI is generic. */
export interface AssistantCopy {
  /** Empty-state heading, e.g. "How can we help you today?" */
  headline: string;
  /** Empty-state paragraph under the heading. */
  intro: string;
  /** Footer sentence(s) before "Confirm details with <contact>". */
  disclaimer: string;
  /** Shown when the model refuses a request outright. */
  refusal: string;
  /** Composer placeholder; defaults to "Ask a question…". */
  placeholder?: string;
}

/** The domain-specific parts of the system prompt. The guardrails around them are fixed in apps/api/src/prompt.ts. */
export interface AssistantPrompt {
  /** One or two sentences: who the assistant serves and what topics it covers. */
  role: string;
  /** Things the assistant never does, each a short clause. Rendered as a list. */
  neverDo: string[];
  /** What to offer instead when declining, one sentence. */
  declineOffer: string;
  /** Extra style or domain lines appended to the Style section. Optional. */
  guidance?: string[];
}

/** One assistant's configuration. Lives in data/sources.json. */
export interface AssistantConfig {
  id: string;
  /** Organization or place the assistant speaks for, e.g. "Example City Public Library". */
  name: string;
  /** Product name shown in the header and browser tab. */
  assistantName: string;
  contact: ContactInfo;
  copy: AssistantCopy;
  prompt: AssistantPrompt;
  crawl: {
    seeds: string[];
    /** URL prefixes (origin + path) that are in scope. */
    allowPrefixes: string[];
    /** Regexes applied to the full URL; matches are skipped. */
    denyPatterns?: string[];
    /** Hosts from which linked PDFs may be downloaded. */
    documentHosts?: string[];
  };
  quickActions: QuickAction[];
  suggestedQuestions: string[];
}

/** Public, browser-safe subset of AssistantConfig served by /api/config. */
export interface PublicConfig {
  organization: { id: string; name: string };
  assistantName: string;
  contact: ContactInfo;
  copy: AssistantCopy;
  quickActions: QuickAction[];
  suggestedQuestions: string[];
  index: { documents: number; chunks: number; lastCrawl: string | null } | null;
}
