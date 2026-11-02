import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DocumentKind } from "@rag-generator/shared";
import { manifestPath, rawDir } from "./paths.js";

export type ManifestStatus = "ok" | "error" | "skipped" | "blocked";

export interface ManifestEntry {
  url: string;
  status: ManifestStatus;
  kind: DocumentKind;
  title?: string;
  fetchedAt?: string;
  contentHash?: string;
  /** Path to extracted markdown/text, relative to data/raw. */
  mdPath?: string;
  /** Path to the raw HTML or PDF snapshot, relative to data/raw. */
  rawPath?: string;
  discoveredFrom?: string;
  /** Anchor text of the link that led here (used as a PDF title fallback). */
  linkText?: string;
  /** In-scope links found on this page, so resumed crawls can re-enqueue them without refetching. */
  links?: string[];
  error?: string;
  attempts: number;
  httpStatus?: number;
  /** Where the content came from. */
  source?: "live" | "wayback";
  /** Viewable Internet Archive URL for this capture. */
  archiveUrl?: string;
}

export interface Manifest {
  version: 1;
  updatedAt: string;
  entries: Record<string, ManifestEntry>;
}

export function loadManifest(): Manifest {
  if (!existsSync(manifestPath)) {
    return { version: 1, updatedAt: new Date().toISOString(), entries: {} };
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

export function saveManifest(manifest: Manifest): void {
  mkdirSync(rawDir, { recursive: true });
  manifest.updatedAt = new Date().toISOString();
  const tmp = manifestPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  renameSync(tmp, manifestPath);
}

export function resolveRawPath(relative: string): string {
  return path.join(rawDir, relative);
}
