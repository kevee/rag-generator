import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, resolved from this file so it works regardless of cwd. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let envLoaded = false;

/** Load the repo-root .env once, using Node 22's built-in loader. Existing env vars win. */
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  const envFile = path.join(repoRoot, ".env");
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

// Load before computing paths so RAG_DATA_DIR / RAG_MODELS_DIR work from .env, not only the shell.
loadEnv();

export const dataDir = process.env.RAG_DATA_DIR ?? path.join(repoRoot, "data");
export const rawDir = path.join(dataDir, "raw");
export const indexPath = path.join(dataDir, "index.sqlite");
export const sourcesPath = path.join(dataDir, "sources.json");
export const manifestPath = path.join(rawDir, "manifest.json");
/** Hugging Face model cache for the local embedder (gitignored; prefetched at deploy build time). */
export const modelsDir = process.env.RAG_MODELS_DIR ?? path.join(dataDir, "models");
