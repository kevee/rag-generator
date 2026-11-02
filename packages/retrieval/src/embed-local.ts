import { mkdirSync } from "node:fs";
import type { Embedder } from "./embed.js";
import { loadEnv, modelsDir } from "./paths.js";

/**
 * Prefixes some retrieval models expect so queries and passages land in the same space.
 * Keyed by Hugging Face repo id; anything not listed is embedded as-is.
 */
const MODEL_PRESETS: Record<string, { query: string; document: string }> = {
  "nomic-ai/nomic-embed-text-v1.5": { query: "search_query: ", document: "search_document: " },
  "nomic-ai/nomic-embed-text-v1": { query: "search_query: ", document: "search_document: " },
  "Xenova/bge-small-en-v1.5": { query: "Represent this sentence for searching relevant passages: ", document: "" },
  "Xenova/bge-base-en-v1.5": { query: "Represent this sentence for searching relevant passages: ", document: "" },
  "Xenova/multilingual-e5-small": { query: "query: ", document: "passage: " },
  "Xenova/multilingual-e5-base": { query: "query: ", document: "passage: " },
};

export const DEFAULT_LOCAL_MODEL = "nomic-ai/nomic-embed-text-v1.5";
export const DEFAULT_LOCAL_DTYPE = "q8";

export interface LocalEmbedderOptions {
  /** Hugging Face repo id with ONNX weights. */
  model?: string;
  /** Weight precision: fp32, fp16, q8, int8, uint8, q4, q4f16, bnb4. q8 is a good CPU default. */
  dtype?: string;
  batchSize?: number;
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean" | "cls"; normalize: boolean },
) => Promise<{ dims: number[]; data: Float32Array | number[] }>;

/**
 * Embeddings computed in-process with Transformers.js (ONNX Runtime on CPU). No network
 * after the first download; weights are cached under data/models so a deploy can bake them in.
 */
export class LocalEmbedder implements Embedder {
  readonly modelId: string;
  /** Known after the first call; nomic-embed-text-v1.5 produces 768-dim vectors. */
  dimensions: number;
  private readonly dtype: string;
  private readonly batchSize: number;
  private readonly prefixes: { query: string; document: string };
  private extractor: Promise<FeatureExtractor> | null = null;

  constructor(options: LocalEmbedderOptions = {}) {
    loadEnv();
    const model = options.model ?? process.env.LOCAL_EMBED_MODEL ?? DEFAULT_LOCAL_MODEL;
    this.dtype = options.dtype ?? process.env.LOCAL_EMBED_DTYPE ?? DEFAULT_LOCAL_DTYPE;
    this.batchSize = options.batchSize ?? 16;
    this.prefixes = MODEL_PRESETS[model] ?? { query: "", document: "" };
    // The dtype is part of the id: int8 and fp32 weights do not produce interchangeable vectors.
    this.modelId = `${model}@${this.dtype}`;
    this.dimensions = Number(process.env.LOCAL_EMBED_DIMENSIONS ?? (model.includes("nomic") ? 768 : 0));
  }

  private get repo(): string {
    return this.modelId.slice(0, this.modelId.lastIndexOf("@"));
  }

  /** Download (if needed) and load the model. Safe to call early so the first query is fast. */
  async load(): Promise<void> {
    await this.getExtractor();
  }

  private getExtractor(): Promise<FeatureExtractor> {
    if (!this.extractor) {
      this.extractor = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        mkdirSync(modelsDir, { recursive: true });
        env.cacheDir = modelsDir;
        env.allowLocalModels = true;
        const started = Date.now();
        const pipe = await pipeline("feature-extraction", this.repo, { dtype: this.dtype as never });
        console.log(`[embed] loaded ${this.modelId} in ${Date.now() - started}ms`);
        return pipe as unknown as FeatureExtractor;
      })();
    }
    return this.extractor;
  }

  private async run(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.getExtractor();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const result = await extractor(batch, { pooling: "mean", normalize: true });
      const [rows, dims] = result.dims;
      if (rows !== batch.length || !dims) {
        throw new Error(`Unexpected embedding shape ${result.dims.join("x")} for ${batch.length} inputs`);
      }
      if (this.dimensions && dims !== this.dimensions) {
        throw new Error(`${this.modelId} produced ${dims} dims, expected ${this.dimensions}`);
      }
      this.dimensions = dims;
      const data = result.data instanceof Float32Array ? result.data : Float32Array.from(result.data);
      for (let r = 0; r < rows; r++) out.push(data.slice(r * dims, (r + 1) * dims));
    }
    return out;
  }

  embedDocuments(texts: string[]): Promise<Float32Array[]> {
    return this.run(texts.map((t) => this.prefixes.document + t));
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vec] = await this.run([this.prefixes.query + text]);
    if (!vec) throw new Error("Local embedder returned no embedding for query");
    return vec;
  }
}
