export interface PageResult {
  status: number;
  html: string;
  title: string;
  links: { href: string; text: string }[];
  /** When the content was captured (live fetch time, or archive capture time). */
  fetchedAt: string;
  archiveUrl?: string;
}

export interface BinaryResult {
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
  contentDisposition?: string;
  fetchedAt: string;
  archiveUrl?: string;
}

export interface Fetcher {
  readonly name: "live" | "wayback";
  /** Base delay between requests; the crawl loop adds jitter. */
  readonly delayMs: number;
  init(): Promise<void>;
  /** Returns null when the source has no copy of this URL. */
  fetchPage(url: string): Promise<PageResult | null>;
  fetchBinary(url: string): Promise<BinaryResult | null>;
  close(): Promise<void>;
}
