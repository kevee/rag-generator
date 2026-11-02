import { readFileSync } from "node:fs";
import { chunkMarkdown } from "./chunk.js";
import {
  type Db,
  deleteChunksForDocument,
  ensureVecTable,
  getCachedEmbedding,
  insertChunk,
  insertEmbedding,
  listDocuments,
  deleteDocument,
  putCachedEmbedding,
  upsertDocument,
} from "./db.js";
import type { Embedder } from "./embed.js";
import { loadManifest, resolveRawPath } from "./manifest.js";

export interface BuildOptions {
  /** Re-chunk and re-embed everything even if content hashes match. */
  force?: boolean;
  /** Remove indexed documents whose manifest entry is gone or not ok. */
  prune?: boolean;
  log?: (message: string) => void;
}

export interface BuildReport {
  documentsSeen: number;
  documentsChanged: number;
  chunksWritten: number;
  chunksEmbedded: number;
  chunksFromCache: number;
  pruned: number;
}

/** Text sent to the embedder: title and heading give the chunk context it lacks on its own. */
export function embeddingInput(title: string, heading: string, text: string): string {
  const prefix = [title, heading].filter(Boolean).join(" > ");
  return prefix ? `${prefix}\n\n${text}` : text;
}

/** Build or update the index from the crawl manifest and extracted markdown on disk. */
export async function buildIndex(db: Db, embedder: Embedder, options: BuildOptions = {}): Promise<BuildReport> {
  const log = options.log ?? (() => {});
  ensureVecTable(db, embedder.modelId, embedder.dimensions);
  const manifest = loadManifest();
  const report: BuildReport = {
    documentsSeen: 0,
    documentsChanged: 0,
    chunksWritten: 0,
    chunksEmbedded: 0,
    chunksFromCache: 0,
    pruned: 0,
  };

  const okEntries = Object.values(manifest.entries).filter((e) => e.status === "ok" && e.mdPath && e.contentHash && e.fetchedAt);

  for (const entry of okEntries) {
    report.documentsSeen++;
    const markdown = readFileSync(resolveRawPath(entry.mdPath!), "utf8");
    const { id, changed } = upsertDocument(db, {
      url: entry.url,
      title: entry.title ?? entry.url,
      kind: entry.kind,
      fetchedAt: entry.fetchedAt!,
      contentHash: entry.contentHash!,
      markdown,
      archiveUrl: entry.archiveUrl,
    });
    if (!changed && !options.force) continue;
    report.documentsChanged++;

    const chunks = chunkMarkdown(markdown);
    const title = entry.title ?? entry.url;

    // Figure out which chunks still need an embedding.
    const pending: { index: number; input: string }[] = [];
    const vectors: (Float32Array | undefined)[] = chunks.map((c, i) => {
      const cached = getCachedEmbedding(db, c.contentHash, embedder.modelId);
      if (cached) {
        report.chunksFromCache++;
        return cached;
      }
      pending.push({ index: i, input: embeddingInput(title, c.heading, c.text) });
      return undefined;
    });

    if (pending.length > 0) {
      log(`embedding ${pending.length} chunks for ${title}`);
      const embedded = await embedder.embedDocuments(pending.map((p) => p.input));
      pending.forEach((p, j) => {
        vectors[p.index] = embedded[j];
      });
      report.chunksEmbedded += pending.length;
    }

    const write = db.transaction(() => {
      deleteChunksForDocument(db, id);
      chunks.forEach((c, i) => {
        const chunkId = insertChunk(db, id, {
          ordinal: c.ordinal,
          heading: c.heading,
          text: c.text,
          tokenCount: c.tokenCount,
          contentHash: c.contentHash,
        });
        const vec = vectors[i];
        if (!vec) throw new Error(`missing embedding for chunk ${i} of ${entry.url}`);
        insertEmbedding(db, chunkId, vec);
        putCachedEmbedding(db, c.contentHash, embedder.modelId, vec);
        report.chunksWritten++;
      });
    });
    write();
  }

  if (options.prune) {
    const live = new Set(okEntries.map((e) => e.url));
    for (const doc of listDocuments(db)) {
      if (!live.has(doc.url)) {
        deleteDocument(db, doc.id);
        report.pruned++;
        log(`pruned ${doc.url}`);
      }
    }
  }

  return report;
}
