import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { DocumentKind, SourceDocument } from "@rag-generator/shared";
import { indexPath } from "./paths.js";

export type Db = Database.Database;

const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  markdown TEXT NOT NULL,
  archive_url TEXT
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  heading TEXT NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);
CREATE TABLE IF NOT EXISTS embedding_cache (
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  embedding BLOB NOT NULL,
  PRIMARY KEY (content_hash, model)
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  heading,
  text,
  tokenize = 'porter unicode61'
);
`;

export interface OpenDbOptions {
  readonly?: boolean;
  file?: string;
}

export function openDb(options: OpenDbOptions = {}): Db {
  const file = options.file ?? indexPath;
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false });
  sqliteVec.load(db);
  db.pragma("foreign_keys = ON");
  if (!options.readonly) {
    db.pragma("journal_mode = WAL");
    db.exec(BASE_SCHEMA);
  }
  return db;
}

export function getMeta(db: Db, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/**
 * Create the vector table for a given embedder, or verify the existing one matches.
 * Mixing embedding models in one table silently ruins recall, so this is strict.
 */
export function ensureVecTable(db: Db, modelId: string, dimensions: number): void {
  const existingModel = getMeta(db, "embedding_model");
  const existingDims = getMeta(db, "embedding_dimensions");
  if (existingModel && (existingModel !== modelId || Number(existingDims) !== dimensions)) {
    throw new Error(
      `Index was built with ${existingModel} (${existingDims} dims) but the configured embedder is ${modelId} (${dimensions} dims). ` +
        `Delete data/index.sqlite and re-run index, or set EMBEDDER / LOCAL_EMBED_MODEL to match.`,
    );
  }
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${dimensions}])`);
  setMeta(db, "embedding_model", modelId);
  setMeta(db, "embedding_dimensions", String(dimensions));
}

export function hasVecTable(db: Db): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunks_vec'")
    .get() as { name: string } | undefined;
  return Boolean(row);
}

export function vecToBuffer(vec: number[] | Float32Array): Buffer {
  const f32 = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export interface UpsertDocumentInput {
  url: string;
  title: string;
  kind: DocumentKind;
  fetchedAt: string;
  contentHash: string;
  markdown: string;
  archiveUrl?: string;
}

/** Insert or update a document. Returns its id and whether its content changed. */
export function upsertDocument(db: Db, doc: UpsertDocumentInput): { id: number; changed: boolean } {
  const existing = db
    .prepare("SELECT id, content_hash FROM documents WHERE url = ?")
    .get(doc.url) as { id: number; content_hash: string } | undefined;
  if (existing && existing.content_hash === doc.contentHash) {
    db.prepare("UPDATE documents SET title = ?, fetched_at = ?, archive_url = ? WHERE id = ?").run(doc.title, doc.fetchedAt, doc.archiveUrl ?? null, existing.id);
    return { id: existing.id, changed: false };
  }
  if (existing) {
    db.prepare("UPDATE documents SET title = ?, kind = ?, fetched_at = ?, content_hash = ?, markdown = ?, archive_url = ? WHERE id = ?").run(
      doc.title,
      doc.kind,
      doc.fetchedAt,
      doc.contentHash,
      doc.markdown,
      doc.archiveUrl ?? null,
      existing.id,
    );
    return { id: existing.id, changed: true };
  }
  const result = db
    .prepare("INSERT INTO documents(url, title, kind, fetched_at, content_hash, markdown, archive_url) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(doc.url, doc.title, doc.kind, doc.fetchedAt, doc.contentHash, doc.markdown, doc.archiveUrl ?? null);
  return { id: Number(result.lastInsertRowid), changed: true };
}

/** Remove a document's chunks from all three tables. */
export function deleteChunksForDocument(db: Db, documentId: number): void {
  const ids = (db.prepare("SELECT id FROM chunks WHERE document_id = ?").all(documentId) as { id: number }[]).map((r) => r.id);
  if (ids.length === 0) return;
  const delFts = db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?");
  const delVec = hasVecTable(db) ? db.prepare("DELETE FROM chunks_vec WHERE chunk_id = ?") : null;
  for (const id of ids) {
    delFts.run(id);
    delVec?.run(id);
  }
  db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);
}

export function deleteDocument(db: Db, documentId: number): void {
  deleteChunksForDocument(db, documentId);
  db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
}

export interface InsertChunkInput {
  ordinal: number;
  heading: string;
  text: string;
  tokenCount: number;
  contentHash: string;
}

export function insertChunk(db: Db, documentId: number, chunk: InsertChunkInput): number {
  const result = db
    .prepare("INSERT INTO chunks(document_id, ordinal, heading, text, token_count, content_hash) VALUES (?, ?, ?, ?, ?, ?)")
    .run(documentId, chunk.ordinal, chunk.heading, chunk.text, chunk.tokenCount, chunk.contentHash);
  const id = Number(result.lastInsertRowid);
  db.prepare("INSERT INTO chunks_fts(chunk_id, heading, text) VALUES (?, ?, ?)").run(id, chunk.heading, chunk.text);
  return id;
}

export function insertEmbedding(db: Db, chunkId: number, embedding: Float32Array | number[]): void {
  db.prepare("INSERT OR REPLACE INTO chunks_vec(chunk_id, embedding) VALUES (?, ?)").run(BigInt(chunkId), vecToBuffer(embedding));
}

export function getCachedEmbedding(db: Db, contentHash: string, model: string): Float32Array | undefined {
  const row = db
    .prepare("SELECT embedding FROM embedding_cache WHERE content_hash = ? AND model = ?")
    .get(contentHash, model) as { embedding: Buffer } | undefined;
  if (!row) return undefined;
  return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
}

export function putCachedEmbedding(db: Db, contentHash: string, model: string, embedding: Float32Array | number[]): void {
  db.prepare("INSERT OR REPLACE INTO embedding_cache(content_hash, model, embedding) VALUES (?, ?, ?)").run(
    contentHash,
    model,
    vecToBuffer(embedding),
  );
}

export function listDocuments(db: Db): SourceDocument[] {
  const rows = db
    .prepare("SELECT id, url, title, kind, fetched_at, content_hash, archive_url FROM documents ORDER BY title")
    .all() as { id: number; url: string; title: string; kind: DocumentKind; fetched_at: string; content_hash: string; archive_url: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    kind: r.kind,
    fetchedAt: r.fetched_at,
    contentHash: r.content_hash,
    archiveUrl: r.archive_url ?? undefined,
  }));
}

export interface IndexStats {
  documents: number;
  chunks: number;
  embeddings: number;
  lastCrawl: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  vecVersion: string;
  fts5: boolean;
}

export function getStats(db: Db): IndexStats {
  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  const vecVersion = (db.prepare("SELECT vec_version() AS v").get() as { v: string }).v;
  const fts5 = Boolean((db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS on_").get() as { on_: number }).on_);
  const last = db.prepare("SELECT MAX(fetched_at) AS t FROM documents").get() as { t: string | null };
  return {
    documents: count("SELECT COUNT(*) AS n FROM documents"),
    chunks: count("SELECT COUNT(*) AS n FROM chunks"),
    embeddings: hasVecTable(db) ? count("SELECT COUNT(*) AS n FROM chunks_vec") : 0,
    lastCrawl: last.t,
    embeddingModel: getMeta(db, "embedding_model") ?? null,
    embeddingDimensions: getMeta(db, "embedding_dimensions") ? Number(getMeta(db, "embedding_dimensions")) : null,
    vecVersion,
    fts5,
  };
}
