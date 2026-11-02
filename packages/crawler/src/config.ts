import type { AssistantConfig } from "@rag-generator/shared";
import { loadAssistantConfig, loadEnv } from "@rag-generator/retrieval";

export interface CrawlConfig {
  county: AssistantConfig;
  seeds: string[];
  allowPrefixes: string[];
  denyPatterns: RegExp[];
  documentHosts: Set<string>;
  delayMs: number;
  timeoutMs: number;
  maxAttempts: number;
  userAgent: string;
  headless: boolean;
  limit: number | undefined;
  force: boolean;
  source: "live" | "wayback";
}

export interface CrawlCliOptions {
  limit?: number;
  force?: boolean;
  headed?: boolean;
  source?: string;
}

export function loadCrawlConfig(opts: CrawlCliOptions = {}): CrawlConfig {
  loadEnv();
  const county = loadAssistantConfig();
  const seedSet = new Set<string>(county.crawl.seeds);
  for (const qa of county.quickActions) if (qa.href) seedSet.add(qa.href);
  const documentHosts = new Set((county.crawl.documentHosts ?? []).map((h) => h.toLowerCase()));
  for (const p of county.crawl.allowPrefixes) documentHosts.add(new URL(p).host.toLowerCase());

  return {
    county,
    seeds: [...seedSet],
    allowPrefixes: county.crawl.allowPrefixes.map((p) => p.toLowerCase().replace(/\/$/, "")),
    denyPatterns: (county.crawl.denyPatterns ?? []).map((p) => new RegExp(p, "i")),
    documentHosts,
    delayMs: Number(process.env.CRAWL_DELAY_MS ?? 2000),
    timeoutMs: Number(process.env.CRAWL_TIMEOUT_MS ?? 45000),
    maxAttempts: 4,
    userAgent:
      process.env.CRAWL_USER_AGENT ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    headless: !opts.headed,
    limit: opts.limit,
    force: Boolean(opts.force),
    source: opts.source === "wayback" ? "wayback" : "live",
  };
}

const DOCUMENT_PATH = /\/home\/(showpublisheddocument|showdocument)\b/i;

/** Canonical form used for dedupe and manifest keys. */
export function normalizeUrl(input: string, base?: string): string | null {
  try {
    const u = new URL(input, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.host = u.host.toLowerCase();
    // Many CMS paths are case-insensitive; lowercase them so /Help and /help dedupe.
    if (!DOCUMENT_PATH.test(u.pathname)) u.pathname = u.pathname.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export function isDocumentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return DOCUMENT_PATH.test(u.pathname) || /\.pdf$/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function isInScope(cfg: CrawlConfig, url: string): boolean {
  const lower = url.toLowerCase();
  if (cfg.denyPatterns.some((re) => re.test(url))) return false;
  if (cfg.allowPrefixes.some((p) => lower === p || lower.startsWith(p + "/") || lower.startsWith(p + "?"))) return true;
  if (isDocumentUrl(url)) {
    try {
      return cfg.documentHosts.has(new URL(url).host.toLowerCase());
    } catch {
      return false;
    }
  }
  return false;
}
