import { JSDOM } from "jsdom";
import { type CrawlConfig, normalizeUrl } from "../config.js";
import type { BinaryResult, Fetcher, PageResult } from "./types.js";

interface Capture {
  original: string;
  timestamp: string;
  mimetype: string;
}

const CDX = "https://web.archive.org/cdx/search/cdx";
const log = (msg: string) => console.log(`[wayback] ${msg}`);

/** 20261018074155 -> 2026-10-18T07:41:55.000Z */
function timestampToIso(ts: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(ts);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
}

/**
 * Reads the Internet Archive's copy of the site instead of the live site.
 * Useful when the live site blocks automated clients; every document records
 * its capture time and a viewable archive URL so the UI can label it.
 */
export class WaybackFetcher implements Fetcher {
  readonly name = "wayback" as const;
  /** archive.org throttles aggressively; stay well under its limits. */
  readonly delayMs = 4000;
  private latest = new Map<string, Capture>();
  private misses = new Set<string>();

  constructor(private readonly cfg: CrawlConfig) {}

  async init(): Promise<void> {
    for (const prefix of this.cfg.allowPrefixes) {
      const u = new URL(prefix);
      const pattern = `${u.host}${u.pathname}*`;
      const rows = await this.cdx({ url: pattern, from: "2024", limit: "50000" });
      for (const c of rows) this.remember(c);
      log(`${rows.length} captures under ${pattern}; ${this.latest.size} unique URLs so far`);
    }
  }

  private remember(c: Capture): void {
    const key = normalizeUrl(c.original);
    if (!key) return;
    const prev = this.latest.get(key);
    if (!prev || prev.timestamp < c.timestamp) this.latest.set(key, c);
  }

  private async cdx(params: Record<string, string>): Promise<Capture[]> {
    const qs = new URLSearchParams({
      output: "json",
      fl: "original,timestamp,mimetype",
      filter: "statuscode:200",
      ...params,
    });
    const text = await this.getWithRetry(`${CDX}?${qs}`, "CDX query");
    if (!text.trim()) return [];
    const rows = JSON.parse(text) as string[][];
    return rows.slice(1).map(([original, timestamp, mimetype]) => ({ original: original!, timestamp: timestamp!, mimetype: mimetype ?? "" }));
  }

  /** archive.org returns 429/503 under load; back off and retry rather than failing the run. */
  private async getWithRetry(url: string, what: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { "user-agent": this.cfg.userAgent } });
      if (res.ok) return res.text();
      const retryable = res.status === 429 || res.status === 503 || res.status === 504;
      if (!retryable || attempt >= 5) throw new Error(`${what} failed (${res.status})`);
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(5000 * 2 ** attempt, 120000);
      log(`${what} got ${res.status}; retrying in ${Math.round(delay / 1000)}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private async resolve(url: string): Promise<Capture | null> {
    const key = normalizeUrl(url) ?? url;
    const known = this.latest.get(key);
    if (known) return known;
    if (this.misses.has(key)) return null;
    // Exact lookup; limit=-1 returns the most recent capture.
    const u = new URL(url);
    const rows = await this.cdx({ url: `${u.host}${u.pathname}${u.search}`, limit: "-1" });
    const c = rows[0];
    if (!c) {
      this.misses.add(key);
      return null;
    }
    this.remember(c);
    return c;
  }

  private rawUrl(c: Capture): string {
    return `https://web.archive.org/web/${c.timestamp}id_/${c.original}`;
  }

  private viewUrl(c: Capture): string {
    return `https://web.archive.org/web/${c.timestamp}/${c.original}`;
  }

  async fetchPage(url: string): Promise<PageResult | null> {
    const c = await this.resolve(url);
    if (!c) return null;
    const res = await fetch(this.rawUrl(c), { headers: { "user-agent": this.cfg.userAgent }, redirect: "follow" });
    const fetchedAt = timestampToIso(c.timestamp);
    const archiveUrl = this.viewUrl(c);
    if (!res.ok) return { status: res.status, html: "", title: "", links: [], fetchedAt, archiveUrl };
    const html = await res.text();
    const dom = new JSDOM(html, { url: c.original });
    const doc = dom.window.document;
    const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => ({
      href: a.href,
      text: (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    }));
    return { status: 200, html, title: doc.title ?? "", links, fetchedAt, archiveUrl };
  }

  async fetchBinary(url: string): Promise<BinaryResult | null> {
    const c = await this.resolve(url);
    if (!c) return null;
    const res = await fetch(this.rawUrl(c), { headers: { "user-agent": this.cfg.userAgent }, redirect: "follow" });
    const body = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      contentType: (res.headers.get("content-type") ?? c.mimetype).toLowerCase(),
      body,
      finalUrl: c.original,
      contentDisposition: res.headers.get("content-disposition") ?? undefined,
      fetchedAt: timestampToIso(c.timestamp),
      archiveUrl: this.viewUrl(c),
    };
  }

  async close(): Promise<void> {}
}
