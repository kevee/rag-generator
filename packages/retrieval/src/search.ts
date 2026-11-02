import type { DocumentKind, RetrievedChunk } from "@rag-generator/shared";
import { type Db, hasVecTable, vecToBuffer } from "./db.js";
import type { Embedder } from "./embed.js";

export interface SearchOptions {
  /** Final number of chunks to return. */
  k?: number;
  /** Candidates pulled from each of vector and keyword search before fusion. */
  candidates?: number;
  /** Max chunks from a single document in the final result. */
  perDocumentCap?: number;
  /** Reciprocal rank fusion constant. */
  rrfK?: number;
}

interface ChunkRow {
  id: number;
  document_id: number;
  url: string;
  title: string;
  kind: DocumentKind;
  heading: string;
  text: string;
  fetched_at: string;
  archive_url: string | null;
}

const STOPWORDS = new Set(
  "a an and are as at be by for from how i in is it of on or that the this to was what when where which who will with you your my me do does can".split(" "),
);

/** Turn free text into a safe FTS5 MATCH expression: quoted terms joined by OR. */
export function toFtsQuery(query: string): string | null {
  const tokens = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  const unique = [...new Set(tokens)].slice(0, 24);
  return unique.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
}

export function vectorSearch(db: Db, queryVec: Float32Array, k: number): { chunkId: number; distance: number }[] {
  if (!hasVecTable(db)) return [];
  const rows = db
    .prepare("SELECT chunk_id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance")
    .all(vecToBuffer(queryVec), k) as { chunk_id: number | bigint; distance: number }[];
  return rows.map((r) => ({ chunkId: Number(r.chunk_id), distance: r.distance }));
}

export function keywordSearch(db: Db, query: string, k: number): { chunkId: number; rank: number }[] {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  const rows = db
    .prepare("SELECT chunk_id, bm25(chunks_fts, 0, 2.0, 1.0) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?")
    .all(fts, k) as { chunk_id: number; rank: number }[];
  return rows.map((r) => ({ chunkId: Number(r.chunk_id), rank: r.rank }));
}

export function getChunks(db: Db, ids: number[]): Map<number, ChunkRow> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT c.id, c.document_id, d.url, d.title, d.kind, c.heading, c.text, d.fetched_at, d.archive_url
       FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id IN (${placeholders})`,
    )
    .all(...ids) as ChunkRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

/** Hybrid retrieval: vector KNN + FTS5 keyword search fused with reciprocal rank fusion. */
export async function hybridSearch(db: Db, embedder: Embedder, query: string, options: SearchOptions = {}): Promise<RetrievedChunk[]> {
  const k = options.k ?? 8;
  const candidates = options.candidates ?? 20;
  const perDocCap = options.perDocumentCap ?? 3;
  const rrfK = options.rrfK ?? 60;

  const queryVec = await embedder.embedQuery(query);
  const vec = vectorSearch(db, queryVec, candidates);
  const kw = keywordSearch(db, query, candidates);

  const scores = new Map<number, { score: number; vectorRank?: number; keywordRank?: number }>();
  vec.forEach((r, i) => {
    const s = scores.get(r.chunkId) ?? { score: 0 };
    s.score += 1 / (rrfK + i + 1);
    s.vectorRank = i + 1;
    scores.set(r.chunkId, s);
  });
  kw.forEach((r, i) => {
    const s = scores.get(r.chunkId) ?? { score: 0 };
    s.score += 1 / (rrfK + i + 1);
    s.keywordRank = i + 1;
    scores.set(r.chunkId, s);
  });

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const rows = getChunks(
    db,
    ranked.map(([id]) => id),
  );

  const perDoc = new Map<number, number>();
  const out: RetrievedChunk[] = [];
  for (const [id, s] of ranked) {
    const row = rows.get(id);
    if (!row) continue;
    const used = perDoc.get(row.document_id) ?? 0;
    if (used >= perDocCap) continue;
    perDoc.set(row.document_id, used + 1);
    out.push({
      chunkId: row.id,
      documentId: row.document_id,
      url: row.url,
      title: row.title,
      kind: row.kind,
      heading: row.heading,
      text: row.text,
      fetchedAt: row.fetched_at,
      archiveUrl: row.archive_url ?? undefined,
      score: s.score,
      vectorRank: s.vectorRank,
      keywordRank: s.keywordRank,
    });
    if (out.length >= k) break;
  }
  return out;
}
