# Troubleshooting

Problems seen while building the template, with the fix that worked.

## Install and tooling

**`ERR_PNPM_IGNORED_BUILDS` naming esbuild, better-sqlite3, onnxruntime-node, protobufjs, or sharp.** pnpm 12 blocks install scripts unless the package is listed under `allowBuilds` in `pnpm-workspace.yaml`. The template lists the ones it needs. If a new dependency adds one, run `pnpm approve-builds <name> --yes`, which adds it to that file.

**`pnpm import` does something strange.** It is pnpm's own command. Use `pnpm run import`.

**`zsh: no matches found`** when a command has `*` or `--include=*.ts`. Quote the glob or use `setopt +o nomatch` for the shell session.

**`timeout: command not found` on macOS.** There is no GNU `timeout`; use the tool's own timeout option or a background job.

**Node is not 22.** `process.loadEnvFile` does not exist on 20 and the native prebuilds target 22. `nvm install 22 && nvm use 22`.

## Corpus

**Importer: "could not determine its URL".** Safari and Firefox saves lack the saved-from comment. Add a `<file>.url` sidecar or pass `--url` for a single file.

**Importer: "outside the configured crawl scope".** Widen `crawl.allowPrefixes` in `data/sources.json` or pass `--allow-out-of-scope` if the one-off is intended.

**Importer: "no text layer".** Scanned PDF. OCR it elsewhere first or find an HTML version.

**Crawl returns 403 for every page.** The site blocks automated clients. Use `--source wayback`, save pages by hand, or ask the owner. Do not attempt evasion.

**Crawl: CDX query failed (503) or 429 from archive.org.** The Internet Archive is throttling. The crawler already retries with backoff; re-run and it resumes. Spacing between requests is 4 seconds; do not reduce it.

**Extracted markdown is navigation, not content.** The main-content selector list missed the site's container. Add the right selector to the front of `CONTENT_SELECTORS` in `packages/crawler/src/extract/html.ts` and re-import or `crawl --force`.

**A document has zero chunks.** The extractor kept almost nothing (threshold 40 characters). Open `data/raw/md/<slug>.md`. Usually the previous item.

## Index and embeddings

**"Index was built with X but the configured embedder is Y".** Deliberate. Either restore the matching `LOCAL_EMBED_MODEL` / `EMBEDDER` setting or `rm data/index.sqlite && pnpm index`.

**"Unable to get model file path or buffer".** The model cache is missing or half-downloaded, or `RAG_MODELS_DIR` points at an empty directory. Run `pnpm run prefetch-model` and let it finish; it prints the model id and dimensions when done.

**First `pnpm index` is slow.** Downloading 140 MB of weights. Subsequent loads take under a second.

**Memory.** The API process sits around 250 to 300 MB with the quantized model loaded. `LOCAL_EMBED_DTYPE=fp32` is slightly more accurate and about four times the memory; stay on `q8` for small hosts.

## API and web

**Vite shows a 502 for `/api`.** The proxy targets `127.0.0.1:${API_PORT ?? 8787}`. If the API is on another port, set `API_PORT` in `.env`. `localhost` was replaced with `127.0.0.1` on purpose because of IPv6 resolution.

**Health shows `anthropicCredentials: false`.** The key is not in `.env`, or the server started before it was added. Restart the dev server; `.env` is read once at startup.

**Chat returns an `error` event with code `upstream` or `rate_limited`.** Claude API side: check the key's spend limit and the Console's rate limits. `refusal` means the safety system declined; the UI shows a friendly message.

**Citations render at the start of the next line.** Fixed in the template by shifting the citation position back over trailing whitespace in `citation-text.tsx`; if it recurs after edits, look there.

**Answers have no citations.** The model answered from the prompt rather than the documents. Either nothing relevant was retrieved (check the `sources` event) or the prompt's "only source of truth" section was weakened in editing.

## Deploy

**The first deployment has no key.** On hosts where variables set after the first deploy do not trigger a redeploy, redeploy once more after setting `ANTHROPIC_API_KEY`.

**Deploy or secret commands denied under an agent's auto mode.** Production deploys and secret-store writes may be blocked by the agent harness. Hand the exact command to the person to run themselves.

**Docker image cannot find `pnpm`.** The Dockerfile installs pnpm with npm rather than relying on corepack, because corepack signature issues have broken builds before. If you changed the base image, keep that line.

**Container builds but health fails.** `PORT` inside the container defaults to 8080 in the Dockerfile; map that port and make sure the host's health check hits `/api/health`, not `/`.
