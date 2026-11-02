import { loadEnv } from "./paths.js";

export interface Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

export interface VoyageOptions {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
  baseUrl?: string;
}

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  usage?: { total_tokens: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Voyage AI embeddings over the REST API. Anthropic has no embeddings endpoint and
 * recommends Voyage; voyage-3.5 produces 1024-dim vectors by default.
 */
export class VoyageEmbedder implements Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly baseUrl: string;
  totalTokens = 0;

  constructor(options: VoyageOptions = {}) {
    loadEnv();
    const apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      throw new Error("VOYAGE_API_KEY is not set. Add it to .env (see .env.example).");
    }
    this.apiKey = apiKey;
    this.modelId = options.model ?? process.env.VOYAGE_MODEL ?? "voyage-3.5";
    this.dimensions = options.dimensions ?? Number(process.env.VOYAGE_DIMENSIONS ?? 1024);
    this.batchSize = options.batchSize ?? 32;
    this.baseUrl = options.baseUrl ?? "https://api.voyageai.com/v1";
  }

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      out.push(...(await this.request(batch, "document")));
    }
    return out;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vec] = await this.request([text], "query");
    if (!vec) throw new Error("Voyage returned no embedding for query");
    return vec;
  }

  private async request(input: string[], inputType: "document" | "query"): Promise<Float32Array[]> {
    const body = JSON.stringify({
      input,
      model: this.modelId,
      input_type: inputType,
      output_dimension: this.dimensions,
      truncation: true,
    });
    let attempt = 0;
    for (;;) {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body,
      });
      if (res.ok) {
        const json = (await res.json()) as VoyageResponse;
        this.totalTokens += json.usage?.total_tokens ?? 0;
        const sorted = [...json.data].sort((a, b) => a.index - b.index);
        return sorted.map((d) => {
          if (d.embedding.length !== this.dimensions) {
            throw new Error(`Voyage returned ${d.embedding.length} dims, expected ${this.dimensions}`);
          }
          return Float32Array.from(d.embedding);
        });
      }
      const text = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= 8) {
        throw new Error(`Voyage embeddings failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      // Accounts without a payment method are capped at 3 requests/minute, so a 429 needs a real pause.
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : res.status === 429 ? 22000 : Math.min(2000 * 2 ** attempt, 30000);
      if (res.status === 429) console.warn(`[voyage] rate limited; waiting ${Math.round(delay / 1000)}s (attempt ${attempt + 1})`);
      await sleep(delay);
      attempt++;
    }
  }
}

export type EmbedderProvider = "local" | "voyage";

/** Which embedder to use: `local` (Transformers.js, default) or `voyage` (hosted). */
export function embedderProvider(): EmbedderProvider {
  loadEnv();
  const value = process.env.EMBEDDER ?? "local";
  if (value !== "local" && value !== "voyage") {
    throw new Error(`EMBEDDER must be "local" or "voyage", got "${value}"`);
  }
  return value;
}

export async function createEmbedder(): Promise<Embedder> {
  if (embedderProvider() === "voyage") return new VoyageEmbedder();
  const { LocalEmbedder } = await import("./embed-local.js");
  const embedder = new LocalEmbedder();
  await embedder.load();
  return embedder;
}
