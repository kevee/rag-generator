import { existsSync } from "node:fs";
import type { RetrievedChunk } from "@rag-generator/shared";
import { type Db, type Embedder, createEmbedder, hybridSearch, indexPath, openDb } from "@rag-generator/retrieval";
import { env } from "./env.js";

let db: Db | null = null;
let embedder: Promise<Embedder> | null = null;

export function indexExists(): boolean {
  return existsSync(indexPath);
}

export function getDb(): Db {
  if (!db) db = openDb({ readonly: true });
  return db;
}

/** Loads the embedder once; with the local provider this downloads/loads model weights. */
export function getEmbedder(): Promise<Embedder> {
  if (!embedder) {
    embedder = createEmbedder().catch((err) => {
      embedder = null; // let the next request retry instead of caching the failure forever
      throw err;
    });
  }
  return embedder;
}

export async function retrieve(question: string): Promise<RetrievedChunk[]> {
  return hybridSearch(getDb(), await getEmbedder(), question, { k: env.retrievalK });
}
