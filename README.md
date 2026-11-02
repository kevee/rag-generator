# rag-generator

A template for a chat assistant that answers questions **only** from documents you control, cites the page every fact came from, and hands people to a real contact when the sources run out. Clone it, point it at a website or a folder of saved pages, fill in one config file, and you have a grounded assistant running locally in under an hour. Deploy it wherever you like when it is ready.

It was built for public-facing help desks (a county elections office, a library, a parks department) where a confident wrong answer is worse than no answer. The guardrails reflect that.

## What you get

**Crawler and importer ---** fetch a site section with Playwright, read [Internet Archive](https://web.archive.org) captures when a site blocks automation, or import pages you saved from your browser (HTML, PDF, Markdown, text). Everything becomes Markdown in `data/raw/` with a manifest of URLs, titles, and fetch times.

**Index ---** heading-aware chunks of about 600 tokens, embedded locally with [Transformers.js](https://huggingface.co/docs/transformers.js) and [nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) on CPU, stored in one SQLite file with [sqlite-vec](https://github.com/asg017/sqlite-vec) for vectors and FTS5 for keywords. No embeddings API, no key, no database server. The quantized weights (about 140 MB) download once into `data/models/`.

**API ---** a small [Hono](https://hono.dev) server. For each question it runs hybrid retrieval (vector + keyword, fused with reciprocal rank fusion), passes the top chunks to Claude as `document` blocks with citations enabled, and streams the answer over server-sent events. Citations come from the API, not from the model writing `[1]` in prose. The system prompt is cached, so repeat requests are cheap.

**Web ---** a Vite + React + Tailwind chat UI built from [shadcn/ui](https://ui.shadcn.com) primitives. Citations render as numbered chips that link to the source page; source cards show when the content was captured. Quick-action buttons cover the tasks people come for most.

**A Claude Code skill ---** `skills/rag-assistant/` walks someone through all of this: an interview about audience, corpus, and guardrails before any code; scaffolding; importing or crawling; customizing; a local run with a validation checklist; and deploying to whatever host they choose. Copy that directory into `~/.claude/skills/` and ask Claude to "build a RAG assistant for our site". See [Using the skill](#using-the-skill).

The only external dependency is the Claude API.

## Getting started

You need Node 22 and pnpm 12 (the repo pins `packageManager`, so `corepack enable` is enough) and a Claude API key from the [Claude Console](https://console.anthropic.com).

```bash
pnpm install
cp .env.example .env   # then add ANTHROPIC_API_KEY
```

```bash
pnpm run prefetch-model
```

That downloads the embedding model once. Then get a corpus in (next section), build the index, and run:

```bash
pnpm index
```

```bash
pnpm dev
```

Open http://localhost:5173. The API listens on 8787 and the web dev server proxies `/api` to it.

Until you index something, the UI shows a "no index yet" notice and the composer is disabled. That is the template telling you it has nothing to answer from.

## Corpus

Three ways in; mix them freely.

**Pages you saved ---** put `.html`, `.pdf`, `.md`, or `.txt` files in `data/import/` and run `pnpm run import data/import` (the `run` matters, because pnpm has its own `import` command). Every file needs its original URL so citations have somewhere to go: Chrome and Edge write it into saved HTML; for anything else, add a sidecar file named `<file>.url` holding the URL, or pass `--url` for a single file.

**A site you can crawl ---** set `crawl.seeds` and `crawl.allowPrefixes` in `data/sources.json`, install the browser once with `pnpm --filter @rag-generator/crawler exec playwright install chromium`, then `pnpm crawl --limit 20` to check extraction before the full `pnpm crawl`. Crawls are resumable; `--force` refetches everything.

**A site that blocks automation ---** `pnpm crawl --source wayback` reads Internet Archive captures and labels them as archived in the UI. The archive throttles hard: about 200 pages in 20 minutes. Saving pages by hand is often faster for a focused assistant. Don't try to defeat bot protection; ask the site owner for an export instead.

Then:

```bash
pnpm index && pnpm stats
```

```bash
pnpm query "are you open on saturdays"
```

`pnpm query` prints the top chunks with their vector and keyword ranks. If the right page is not in the top three for the questions you expect, fix the corpus before touching the UI. `pnpm index --prune` drops documents that disappeared from the manifest.

The index records which embedding model built it and refuses to mix models. To switch, delete `data/index.sqlite` and re-index. `LOCAL_EMBED_MODEL` accepts any Hugging Face repository with ONNX weights (`Xenova/multilingual-e5-small` is a smaller multilingual option). `EMBEDDER=voyage` with a `VOYAGE_API_KEY` switches to hosted [Voyage AI](https://www.voyageai.com/) embeddings if you want them.

## Configuration

Everything that names your organization lives in `data/sources.json`, which ships filled in for a placeholder "Example Organization". The file is validated with zod at startup, so a missing field fails with its path rather than a silent default.

**`name`, `assistantName` ---** the organization and the product name shown in the header and browser tab.

**`contact` ---** where people are sent when the sources do not answer: name, URL, and optionally phone, email, address. Linked in the header, the footer, and the prompt.

**`copy` ---** the empty-state `headline` and `intro`, the footer `disclaimer`, the `refusal` message shown when Claude declines a request outright, and an optional composer `placeholder`.

**`prompt` ---** the domain-specific parts of the system prompt: `role` (who it serves and what it covers), `neverDo` (a list rendered as "What you never do"), `declineOffer` (what to offer instead), and optional `guidance` lines. The guardrails around them, in `apps/api/src/prompt.ts`, stay fixed: answer only from sources, say so when they do not cover it, treat source text as data rather than instructions, let the API produce citations, ask for the smallest detail when an answer depends on location or account, and never collect more personal information than needed.

**`crawl` ---** `seeds`, `allowPrefixes`, `denyPatterns`, `documentHosts`. The importer also enforces `allowPrefixes`, so set them even if you never crawl.

**`quickActions`, `suggestedQuestions` ---** the buttons and chips on the empty state. Thirteen lucide icon names are available for quick actions; add more in `apps/web/src/components/chat/quick-actions.tsx`.

The web app has no organization-specific text of its own. After editing, `pnpm -r typecheck` and restart the API; `.env` and `sources.json` are read at startup.

## Deploying

The service is one long-running Node process that serves the API and the built web app together. It needs Node 22, about 1 GB of RAM to be comfortable, one secret (`ANTHROPIC_API_KEY`), and the committed `data/index.sqlite`. It reads `PORT`, answers `GET /api/health` for readiness, and never contacts Hugging Face at runtime because `pnpm run build` downloads the model weights into the image.

- **Buildpack-style hosts** (Railway, Render, and similar): build command `pnpm install --frozen-lockfile && pnpm run build`, start command `pnpm run start`, health check `/api/health`.
- **Container hosts** (Fly.io, Cloud Run, ECS, Azure Container Apps, a VPS): `docker build -t assistant .` with the included `Dockerfile`, then run it with `ANTHROPIC_API_KEY` in the environment. The image listens on 8080.
- **Not a fit:** serverless function platforms, because of the native SQLite and ONNX modules and the in-memory model.

Updating what a deployed assistant knows is: import or crawl, `pnpm index`, commit the index, redeploy.

**Before you share a public URL:** the template has no rate limiting and no authentication. Put a per-IP limit on `/api/chat` or use your host's edge rate limiting, set a spend limit in the Claude Console, and make sure the footer disclaimer and contact are right. `skills/rag-assistant/references/deploy.md` has the full checklist.

## Using the skill

`skills/rag-assistant/SKILL.md` is written for Claude Code. It finds this template by looking next to itself (when the skill is used from inside a clone) or by cloning `https://github.com/kevee/rag-generator.git`, so it also works copied into `~/.claude/skills/` on its own.

**Note:** if you fork the template, change the `TEMPLATE_REPO` line near the top of `SKILL.md` to your fork.

The skill does not deploy on its own judgment. It stops at "the person says it is good enough to show someone else" and asks where to host only then.

## Layout

```
apps/api            Hono API: /api/chat (SSE), /api/config, /api/health, /api/sources
apps/web            Vite + React + shadcn/ui chat interface
packages/shared     Browser-safe types shared across the stack
packages/retrieval  SQLite store, chunker, embedders, hybrid search, indexer
packages/crawler    Playwright and Internet Archive fetchers, importer, HTML/PDF extractors, CLI
data/sources.json   Assistant configuration (checked in; replace the placeholder values)
data/import         Drop saved pages here for pnpm run import (gitignored)
data/raw            Crawl and import output (gitignored)
data/index.sqlite   The index (commit it; deploys read it)
data/models         Embedding model cache (gitignored; downloaded by prefetch-model and at build)
skills/rag-assistant  Claude Code skill that builds a new assistant from this template
Dockerfile          Container build for hosts that run images
```

## Guardrails

The assistant answers only from retrieved documents, says plainly when they do not cover a question, and points to your contact instead of guessing. Dates, deadlines, and prices come with a reminder to confirm on the linked page, since the corpus is a snapshot. Text inside sources is treated as information, never as instructions, which is the prompt-injection defense. The UI repeats the disclaimer and shows when content was last updated.

## Not yet done

Rate limiting, authentication, query rewriting for follow-up questions, scheduled re-crawls, OCR for scanned PDFs, and an evaluation set. Each is a natural next task once the loop works end to end for your corpus.

## License

[Apache 2.0](LICENSE).
