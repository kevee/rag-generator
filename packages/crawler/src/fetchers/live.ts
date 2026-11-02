import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import type { CrawlConfig } from "../config.js";
import type { BinaryResult, Fetcher, PageResult } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait for the Vision CMS Angular shell to render real content, without relying on `load`. */
async function waitForContent(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  try {
    await page.waitForSelector("#sitebody, #pagebody, main, #content", { timeout: Math.min(timeoutMs, 20000) });
  } catch {
    // fall through to the stabilization loop
  }
  let lastLen = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const len = await page
      .evaluate(
        () =>
          ((document.querySelector("#sitebody, #pagebody, main, #content") as HTMLElement | null) ?? document.body)?.innerText.length ?? 0,
      )
      .catch(() => 0);
    if (len > 200 && len === lastLen) {
      stable++;
      if (stable >= 2) return;
    } else {
      stable = 0;
    }
    lastLen = len;
    await sleep(750);
  }
}

/** Fetches straight from the county site with a real browser. */
export class LiveFetcher implements Fetcher {
  readonly name = "live" as const;
  readonly delayMs: number;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private readonly cfg: CrawlConfig) {
    this.delayMs = cfg.delayMs;
  }

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: this.cfg.headless });
    this.context = await this.browser.newContext({
      userAgent: this.cfg.userAgent,
      locale: "en-US",
      viewport: { width: 1280, height: 900 },
    });
    this.page = await this.context.newPage();
  }

  async fetchPage(url: string): Promise<PageResult> {
    const page = this.page!;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.cfg.timeoutMs });
    const status = response?.status() ?? 0;
    const fetchedAt = new Date().toISOString();
    if (status >= 400) {
      return { status, html: (await page.content().catch(() => "")) ?? "", title: await page.title().catch(() => ""), links: [], fetchedAt };
    }
    await waitForContent(page, this.cfg.timeoutMs);
    const html = await page.content();
    const title = await page.title();
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => ({
        href: a.href,
        text: (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      })),
    );
    return { status, html, title, links, fetchedAt };
  }

  async fetchBinary(url: string): Promise<BinaryResult> {
    // The browser context carries cookies set during page loads.
    const res = await this.context!.request.get(url, {
      timeout: this.cfg.timeoutMs,
      headers: { accept: "application/pdf,text/html;q=0.9,*/*;q=0.8" },
      maxRedirects: 5,
    });
    const headers = res.headers();
    return {
      status: res.status(),
      contentType: (headers["content-type"] ?? "").toLowerCase(),
      body: await res.body(),
      finalUrl: res.url(),
      contentDisposition: headers["content-disposition"],
      fetchedAt: new Date().toISOString(),
    };
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }
}
