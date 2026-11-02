import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { type Manifest, type ManifestEntry, loadManifest, rawDir, repoRoot, resolveRawPath, saveManifest, sha256 } from "@rag-generator/retrieval";
import { type CrawlConfig, isInScope, normalizeUrl } from "./config.js";
import { htmlToMarkdown } from "./extract/html.js";
import { pdfToText } from "./extract/pdf.js";

const log = (msg: string) => console.log(`[import] ${msg}`);

export interface ImportOptions {
  /** URL to record for a single imported file. */
  url?: string;
  /** Accept pages outside the configured crawl scope. */
  allowOutOfScope?: boolean;
}

export interface ImportReport {
  imported: number;
  skipped: number;
}

function slugFor(url: string): string {
  const u = new URL(url);
  const base = (u.pathname + (u.search ? "_" + u.search : ""))
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return `${base || "index"}-${createHash("sha1").update(url).digest("hex").slice(0, 8)}`;
}

function writeRaw(relative: string, data: string | Buffer): string {
  const abs = resolveRawPath(relative);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return relative;
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();

/** Find the page's original URL in a browser "Save as" HTML file. */
function detectHtmlUrl(html: string, cfg: CrawlConfig): string | null {
  // Chrome and Edge: <!-- saved from url=(0068)https://example.com/page -->
  const saved = /saved from url=\(\d+\)(\S+)/i.exec(html)?.[1];
  if (saved) return saved;
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const canonical = doc.querySelector<HTMLLinkElement>("link[rel='canonical']")?.href;
  if (canonical) return canonical;
  const og = doc.querySelector<HTMLMetaElement>("meta[property='og:url']")?.content;
  if (og) return og;

  // Safari and Firefox saves carry no source URL. On CMS sites the navigation links to the
  // current page with its own title as anchor text, so match the <title> against in-scope links.
  const title = norm((doc.title ?? "").replace(/\s*[|\-–]\s*County of .*$/i, ""));
  if (!title) return null;
  const candidates = new Map<string, number>();
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href");
    if (!href || /^(javascript:|#|mailto:|tel:)/i.test(href)) continue;
    let abs: string;
    try {
      abs = new URL(href, cfg.allowPrefixes[0]).toString();
    } catch {
      continue;
    }
    const n = normalizeUrl(abs);
    if (!n || !isInScope(cfg, n)) continue;
    const text = norm(a.textContent ?? "");
    if (!text) continue;
    const score = text === title ? 3 : text.startsWith(title) || title.startsWith(text) ? 1 : 0;
    if (score) candidates.set(n, Math.max(candidates.get(n) ?? 0, score));
  }
  const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
  const best = ranked[0];
  if (!best) return null;
  // Refuse a guess when two different URLs tie for the best score.
  if (ranked[1] && ranked[1][1] === best[1]) return null;
  return best[0];
}

/** A sidecar file next to a PDF holding its original URL: report.pdf -> report.pdf.url or report.url */
function sidecarUrl(file: string): string | null {
  for (const candidate of [`${file}.url`, file.replace(/\.[^.]+$/, ".url")]) {
    if (existsSync(candidate)) {
      const text = readFileSync(candidate, "utf8").trim();
      // Windows .url shortcut files have URL=... lines; plain files hold the URL alone.
      const m = /^URL=(.+)$/m.exec(text);
      return (m?.[1] ?? text.split(/\r?\n/)[0] ?? "").trim() || null;
    }
  }
  return null;
}

/**
 * Import pages or PDFs you saved from your own browser into data/raw, so they can be indexed
 * like crawled pages. Useful when the live site blocks automated clients.
 */
/** pnpm runs package scripts from the package directory, so resolve against where the user typed the command. */
function resolveTarget(target: string): string {
  if (path.isAbsolute(target)) return target;
  const candidates = [process.env.INIT_CWD, process.cwd(), repoRoot].filter((d): d is string => Boolean(d)).map((d) => path.resolve(d, target));
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

const IMPORTABLE = /\.(html?|pdf|md|markdown|txt)$/i;

export async function importFiles(cfg: CrawlConfig, rawTarget: string, options: ImportOptions = {}): Promise<ImportReport> {
  mkdirSync(rawDir, { recursive: true });
  const manifest: Manifest = loadManifest();
  const report: ImportReport = { imported: 0, skipped: 0 };
  const target = resolveTarget(rawTarget);
  if (!existsSync(target)) throw new Error(`${rawTarget} not found (looked in ${process.env.INIT_CWD ?? process.cwd()} and ${repoRoot})`);

  const files = statSync(target).isDirectory()
    ? readdirSync(target)
        .filter((f) => IMPORTABLE.test(f))
        .map((f) => path.join(target, f))
        .sort()
    : [target];

  if (options.url && files.length > 1) {
    throw new Error("--url applies to a single file; for a directory, rely on saved-from comments or .url sidecars.");
  }

  for (const file of files) {
    const isPdf = /\.pdf$/i.test(file);
    const isHtml = /\.html?$/i.test(file);
    const buffer = readFileSync(file);
    const rawUrl = options.url ?? sidecarUrl(file) ?? (isHtml ? detectHtmlUrl(buffer.toString("utf8"), cfg) : null);
    const url = rawUrl ? normalizeUrl(rawUrl) : null;
    if (!url) {
      log(`skip ${path.basename(file)}: could not determine its URL (pass --url, or add a ${path.basename(file)}.url sidecar)`);
      report.skipped++;
      continue;
    }
    if (!options.allowOutOfScope && !isInScope(cfg, url)) {
      log(`skip ${path.basename(file)}: ${url} is outside the configured crawl scope (use --allow-out-of-scope)`);
      report.skipped++;
      continue;
    }

    const fetchedAt = statSync(file).mtime.toISOString();
    const slug = slugFor(url);
    const entry: ManifestEntry = manifest.entries[url] ?? { url, status: "error", kind: isPdf ? "pdf" : "html", attempts: 0 };
    entry.attempts++;
    entry.source = "live";
    delete entry.archiveUrl;

    if (isPdf) {
      const extracted = await pdfToText(buffer);
      if (extracted.empty) {
        log(`skip ${path.basename(file)}: no text layer`);
        entry.status = "skipped";
        entry.error = `no text layer (${extracted.pages} pages)`;
        report.skipped++;
      } else {
        const title = extracted.title ?? path.basename(file, path.extname(file)).replace(/[_-]+/g, " ");
        entry.kind = "pdf";
        entry.rawPath = writeRaw(`pdf/${slug}.pdf`, buffer);
        entry.mdPath = writeRaw(`md/${slug}.md`, `# ${title}\n\n${extracted.text}`);
        entry.title = title;
        entry.contentHash = sha256(extracted.text);
        entry.fetchedAt = fetchedAt;
        entry.status = "ok";
        delete entry.error;
        report.imported++;
        log(`ok "${title}" (${extracted.pages} pages) <- ${path.basename(file)}`);
      }
    } else if (!isHtml) {
      // Plain markdown or text the user pasted or exported: index as-is, first line as title if it is a heading.
      const text = buffer.toString("utf8").replace(/\r\n/g, "\n").trim();
      const firstLine = text.split("\n")[0] ?? "";
      const title = firstLine.replace(/^#+\s*/, "").trim() || path.basename(file, path.extname(file));
      const markdown = /^#/.test(firstLine) ? text : `# ${title}\n\n${text}`;
      entry.kind = "html";
      entry.rawPath = writeRaw(`html/${slug}${path.extname(file)}`, buffer);
      entry.mdPath = writeRaw(`md/${slug}.md`, markdown);
      entry.title = title;
      entry.contentHash = sha256(markdown);
      entry.fetchedAt = fetchedAt;
      entry.status = "ok";
      delete entry.error;
      report.imported++;
      log(`ok "${title}" (text, ${markdown.length} chars) <- ${path.basename(file)}`);
    } else {
      const html = buffer.toString("utf8");
      const extracted = htmlToMarkdown(html, url);
      entry.kind = "html";
      entry.rawPath = writeRaw(`html/${slug}.html`, html);
      if (extracted.markdown.length < 40) {
        entry.status = "skipped";
        entry.error = "no content extracted";
        report.skipped++;
        log(`skip ${path.basename(file)}: no content extracted`);
      } else {
        entry.mdPath = writeRaw(`md/${slug}.md`, extracted.markdown);
        entry.title = extracted.title;
        entry.contentHash = sha256(extracted.markdown);
        entry.fetchedAt = fetchedAt;
        entry.status = "ok";
        delete entry.error;
        report.imported++;
        log(`ok "${extracted.title}" (${extracted.method}, ${extracted.markdown.length} chars) <- ${path.basename(file)}`);
      }
    }
    manifest.entries[url] = entry;
  }

  saveManifest(manifest);
  return report;
}
