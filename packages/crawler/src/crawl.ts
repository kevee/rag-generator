import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Manifest, type ManifestEntry, loadManifest, rawDir, resolveRawPath, saveManifest, sha256 } from "@rag-generator/retrieval";
import { type CrawlConfig, isDocumentUrl, isInScope, normalizeUrl } from "./config.js";
import { htmlToMarkdown } from "./extract/html.js";
import { pdfToText } from "./extract/pdf.js";
import { LiveFetcher } from "./fetchers/live.js";
import type { BinaryResult, Fetcher, PageResult } from "./fetchers/types.js";
import { WaybackFetcher } from "./fetchers/wayback.js";

interface FrontierItem {
  url: string;
  from?: string;
  linkText?: string;
}

export interface CrawlReport {
  source: Fetcher["name"];
  fetched: number;
  skipped: number;
  errors: number;
  blocked: number;
  missing: number;
  discovered: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`[crawl] ${msg}`);

function slugFor(url: string): string {
  const u = new URL(url);
  const base = (u.pathname + (u.search ? "_" + u.search : ""))
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
  return `${base || "index"}-${hash}`;
}

function writeRaw(relative: string, data: string | Buffer): string {
  const abs = resolveRawPath(relative);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return relative;
}

function looksBlocked(title: string, html: string): boolean {
  return /access denied/i.test(title) || /errors\.edgesuite\.net|Reference&#32;&#35;/i.test(html);
}

export function createFetcher(cfg: CrawlConfig): Fetcher {
  return cfg.source === "wayback" ? new WaybackFetcher(cfg) : new LiveFetcher(cfg);
}

export async function crawl(cfg: CrawlConfig): Promise<CrawlReport> {
  mkdirSync(rawDir, { recursive: true });
  const manifest: Manifest = loadManifest();
  const fetcher = createFetcher(cfg);
  const report: CrawlReport = { source: fetcher.name, fetched: 0, skipped: 0, errors: 0, blocked: 0, missing: 0, discovered: 0 };

  const queued = new Set<string>();
  const frontier: FrontierItem[] = [];
  const enqueue = (item: FrontierItem) => {
    const n = normalizeUrl(item.url);
    if (!n || queued.has(n) || !isInScope(cfg, n)) return;
    queued.add(n);
    frontier.push({ ...item, url: n });
  };

  for (const seed of cfg.seeds) enqueue({ url: seed });
  // Resume: re-enqueue links recorded on previous runs so skipped pages still expand the frontier.
  for (const entry of Object.values(manifest.entries)) {
    for (const l of entry.links ?? []) enqueue({ url: l, from: entry.url });
  }

  log(`source=${fetcher.name}; ${frontier.length} URLs to start; ${Object.keys(manifest.entries).length} entries already in manifest`);
  await fetcher.init();

  let processed = 0;
  try {
    while (frontier.length > 0) {
      if (cfg.limit !== undefined && processed >= cfg.limit) {
        log(`limit of ${cfg.limit} reached; ${frontier.length} URLs left in frontier`);
        break;
      }
      const item = frontier.shift()!;
      const existing: ManifestEntry | undefined = manifest.entries[item.url];

      if (existing && !cfg.force) {
        const retryable = (existing.status === "error" || existing.status === "blocked") && existing.attempts < cfg.maxAttempts;
        if (!retryable) {
          report.skipped++;
          continue;
        }
      }

      const entry: ManifestEntry = existing ?? {
        url: item.url,
        status: "error",
        kind: isDocumentUrl(item.url) ? "pdf" : "html",
        attempts: 0,
      };
      if (item.from) entry.discoveredFrom = item.from;
      if (item.linkText) entry.linkText = item.linkText;
      entry.attempts++;
      entry.source = fetcher.name;

      try {
        if (isDocumentUrl(item.url)) {
          await handleDocument(fetcher, cfg, item, entry, enqueue);
        } else {
          await handlePage(fetcher, cfg, item, entry, enqueue);
        }
      } catch (err) {
        entry.status = "error";
        entry.error = err instanceof Error ? err.message.slice(0, 500) : String(err);
        log(`error ${item.url}: ${entry.error}`);
      }

      if (entry.status === "ok") report.fetched++;
      else if (entry.status === "blocked") report.blocked++;
      else if (entry.status === "error") report.errors++;
      else if (entry.error?.startsWith("not in archive")) report.missing++;
      else report.skipped++;

      manifest.entries[item.url] = entry;
      saveManifest(manifest);
      processed++;

      if (entry.status === "blocked") {
        const backoff = Math.min(60000 * entry.attempts, 300000);
        log(`${entry.error}; backing off ${backoff / 1000}s`);
        await sleep(backoff);
        if (entry.attempts < cfg.maxAttempts) {
          frontier.push(item); // retry later in this run
          processed--; // a rate-limited attempt should not consume the --limit budget
        }
      } else {
        await sleep(fetcher.delayMs + Math.random() * fetcher.delayMs);
      }
    }
  } finally {
    await fetcher.close();
  }

  report.discovered = queued.size;
  return report;
}

function recordHtml(entry: ManifestEntry, url: string, html: string, result: Pick<PageResult, "fetchedAt" | "archiveUrl">): string[] {
  const slug = slugFor(url);
  entry.kind = "html";
  entry.rawPath = writeRaw(`html/${slug}.html`, html);
  entry.archiveUrl = result.archiveUrl;
  const extracted = htmlToMarkdown(html, url);
  if (extracted.markdown.length < 40) {
    entry.status = "skipped";
    entry.error = "no content extracted";
  } else {
    entry.status = "ok";
    delete entry.error;
    entry.title = extracted.title;
    entry.contentHash = sha256(extracted.markdown);
    entry.fetchedAt = result.fetchedAt;
    entry.mdPath = writeRaw(`md/${slug}.md`, extracted.markdown);
  }
  return [extracted.method, String(extracted.markdown.length)];
}

async function handlePage(
  fetcher: Fetcher,
  cfg: CrawlConfig,
  item: FrontierItem,
  entry: ManifestEntry,
  enqueue: (i: FrontierItem) => void,
): Promise<void> {
  log(`GET ${item.url}`);
  const result = await fetcher.fetchPage(item.url);
  if (!result) {
    entry.status = "skipped";
    entry.error = "not in archive";
    entry.attempts = cfg.maxAttempts;
    log(`  not in archive`);
    return;
  }
  entry.httpStatus = result.status;

  if (result.status === 429) {
    entry.status = "blocked";
    entry.error = "rate limited (HTTP 429)";
    return;
  }
  if (result.status === 403 || looksBlocked(result.title, result.html)) {
    entry.status = "blocked";
    entry.error = `blocked (HTTP ${result.status})`;
    return;
  }
  if (result.status >= 400) {
    entry.status = "error";
    entry.error = `HTTP ${result.status}`;
    entry.attempts = cfg.maxAttempts; // don't retry 404s
    return;
  }

  const [method, chars] = recordHtml(entry, item.url, result.html, result);

  const inScope: string[] = [];
  for (const l of result.links) {
    const n = normalizeUrl(l.href, item.url);
    if (!n || !isInScope(cfg, n)) continue;
    inScope.push(n);
    enqueue({ url: n, from: item.url, linkText: l.text });
  }
  entry.links = [...new Set(inScope)];
  log(`  ${entry.status} "${entry.title ?? result.title}" (${method}, ${chars} chars, ${entry.links.length} in-scope links)`);
}

async function handleDocument(
  fetcher: Fetcher,
  cfg: CrawlConfig,
  item: FrontierItem,
  entry: ManifestEntry,
  enqueue: (i: FrontierItem) => void,
): Promise<void> {
  log(`DOC ${item.url}`);
  const res: BinaryResult | null = await fetcher.fetchBinary(item.url);
  if (!res) {
    entry.status = "skipped";
    entry.error = "not in archive";
    entry.attempts = cfg.maxAttempts;
    log(`  not in archive`);
    return;
  }
  entry.httpStatus = res.status;

  if (res.status === 429) {
    entry.status = "blocked";
    entry.error = "rate limited (HTTP 429)";
    return;
  }
  if (res.status === 403) {
    entry.status = "blocked";
    entry.error = "blocked (HTTP 403)";
    return;
  }
  if (res.status >= 400) {
    entry.status = "error";
    entry.error = `HTTP ${res.status}`;
    entry.attempts = cfg.maxAttempts;
    return;
  }

  const isPdf = res.contentType.includes("application/pdf") || res.body.subarray(0, 5).toString("latin1") === "%PDF-";

  if (!isPdf && res.contentType.includes("text/html")) {
    // A document link that resolves to a web page.
    const html = res.body.toString("utf8");
    if (looksBlocked("", html)) {
      entry.status = "blocked";
      entry.error = "blocked (challenge page)";
      return;
    }
    const finalUrl = normalizeUrl(res.finalUrl) ?? item.url;
    if (finalUrl !== item.url && isInScope(cfg, finalUrl)) {
      entry.status = "skipped";
      entry.error = `redirected to page ${finalUrl}`;
      enqueue({ url: finalUrl, from: item.from, linkText: item.linkText });
      return;
    }
    recordHtml(entry, item.url, html, res);
    return;
  }

  if (!isPdf) {
    entry.status = "skipped";
    entry.error = `unsupported content-type ${res.contentType || "unknown"}`;
    return;
  }

  entry.kind = "pdf";
  entry.archiveUrl = res.archiveUrl;
  const slug = slugFor(item.url);
  entry.rawPath = writeRaw(`pdf/${slug}.pdf`, res.body);
  const extracted = await pdfToText(res.body);
  if (extracted.empty) {
    entry.status = "skipped";
    entry.error = `no text layer (${extracted.pages} pages)`;
    log(`  skipped scanned PDF (${extracted.pages} pages)`);
    return;
  }

  const fileName = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(res.contentDisposition ?? "")?.[1];
  const title =
    extracted.title ??
    item.linkText ??
    (fileName ? decodeURIComponent(fileName).replace(/\.pdf$/i, "").replace(/[_-]+/g, " ") : null) ??
    item.url;

  entry.title = title;
  entry.contentHash = sha256(extracted.text);
  entry.fetchedAt = res.fetchedAt;
  entry.mdPath = writeRaw(`md/${slug}.md`, `# ${title}\n\n${extracted.text}`);
  entry.status = "ok";
  delete entry.error;
  log(`  ok "${title}" (${extracted.pages} pages, ${extracted.text.length} chars)`);
}
