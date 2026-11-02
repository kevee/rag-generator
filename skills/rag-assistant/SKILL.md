---
name: rag-assistant
description: Build a grounded, citation-first chat assistant over someone's own documents or website, using the rag-generator template (pnpm TypeScript monorepo, Hono API, Vite + React + shadcn/ui, sqlite-vec + FTS5 hybrid retrieval, local Transformers.js embeddings, Claude with document citations). Use this whenever someone wants a RAG chatbot, a "chat with our website/docs/policies" tool, a public Q&A assistant that must only answer from approved sources, or wants a public assistant like a city, county, library, or school help desk bot, even if they never say "RAG" or "vector". It interviews them before touching code, gets a local service running for them to validate, and helps deploy to whatever host they choose when they are ready.
---

# RAG assistant from the rag-generator template

You are helping someone stand up a chat assistant that answers questions **only** from a corpus they control, cites the page every fact came from, and refuses to fill gaps from memory. This skill walks a new person from "I have some documents" to a running service they have personally validated, then to a deploy on the host of their choosing.

The person may be a developer or may be a program manager who has never run `pnpm`. Match their vocabulary. Explain a term the first time you use it if you are not sure they know it.

## What you build, and why it is fixed

Reuse the template as-is rather than assembling a fresh stack. The pieces were chosen to work together with no servers to run and one external dependency (the Claude API):

- **pnpm workspace, TypeScript end to end ---** `apps/api` (Hono), `apps/web` (Vite + React + Tailwind + shadcn-style primitives), `packages/retrieval` (SQLite store, chunker, embedders, hybrid search), `packages/crawler` (importer, Playwright and Internet Archive fetchers, CLI).
- **Retrieval ---** one SQLite file, `data/index.sqlite`, holding chunks, a sqlite-vec vector table, and an FTS5 keyword table. Vector and keyword results are fused with reciprocal rank fusion. The index is committed to git so a deploy ships with its corpus.
- **Embeddings ---** run in-process with `@huggingface/transformers` (`nomic-embed-text-v1.5`, 768 dims, quantized). No embeddings API, no key. Weights download once into `data/models/` and are baked into deploy builds.
- **Generation ---** Claude (`claude-opus-5-5` by default) with retrieved chunks passed as `document` blocks and citations enabled, so citations come from the API rather than from the model writing `[1]` in prose. Streamed to the browser over server-sent events.
- **Configuration, not code ---** the organization, escalation contact, crawl scope, quick-action buttons, and suggested questions live in `data/sources.json`. Guardrail text lives in `apps/api/src/prompt.ts`.

Do not swap any of these for another framework, vector database, or embeddings provider unless the person asks for it explicitly and understands they are leaving the template.

## Where the template lives

Resolve the template in this order:

1. **The person wants to work on this checkout ---** if the working directory has `data/sources.json` and `packages/retrieval/` *and* the person is asking to adapt this very project (rather than make a new one), skip scaffolding and work here. If they want a separate assistant, treat the working directory as the template to copy from, never as the place to build.
2. **Next to this skill ---** this skill ships inside the template at `skills/rag-assistant/`. If `<skill dir>/../../data/sources.json` exists, that checkout is the template. Clone or copy it; do not build the new project inside it.
3. **TEMPLATE_REPO ---** `https://github.com/kevee/rag-generator.git`. Clone it.

If none of these resolve, stop and ask the person where the template is. Do not try to recreate the stack from memory.

## The workflow

Seven phases, each with a gate. The gates exist because every phase is cheaper to redo than the one after it: a wrong answer in the interview costs a minute, a wrong corpus costs an hour, a wrong deploy costs real money and public embarrassment.

Keep a task list for the person. Say what phase you are in when you move.

### Phase 0: Prerequisites

Check, don't assume. One shell call covers it:

```bash
node -v; pnpm -v; git --version; docker --version 2>/dev/null || echo "docker: not installed (optional)"; sqlite3 -version 2>/dev/null || echo "sqlite3 CLI: not installed (optional, handy for inspecting the index)"
```

- **Node 22** is required (`process.loadEnvFile`, native module prebuilds). Point to [nodejs.org](https://nodejs.org) or `nvm install 22` if missing.
- **pnpm 12.** `corepack enable` is enough once Node 22 is present, because the template pins `packageManager`.
- **A Claude API key** from the [Claude Console](https://console.anthropic.com). Ask whether they have one; do not ask them to paste it in chat. They put it in `.env` themselves, or you write it there from an environment variable they have already set. Never echo a key into the conversation or a log.
- **Docker** is optional and only matters for some deploy targets.

### Phase 1: Interview before anything else

Read `references/interview.md` and run the interview. Use `AskUserQuestion` when you have it (two rounds of up to four questions); otherwise ask in prose and wait. Do not clone, install, or write files until you have answers to the first round, because the answers decide the corpus path, the scope rules, and the prompt.

The essentials you must leave the interview with:

1. Who asks questions, about what, and what the assistant must never do.
2. What form the corpus is in (saved files, a crawlable site, a bot-blocked site, plain text) and roughly how big.
3. Whether documents have public URLs to cite. Citations are the whole point; a corpus with no addresses needs a plan for what the citation links to.
4. Three or four high-value tasks that become quick-action buttons.
5. The escalation contact (name, URL, phone or email) the assistant hands people to when sources run out.
6. Language(s) people will write in.
7. Hosting intent: local only for now, deploy later, or deploy as soon as it works. You have no preference; you need to know so you can set expectations about what "done" means today.
8. Project name and where on disk it goes.

Read the answers back in a short summary and get a yes before Phase 2.

### Phase 2: Scaffold

```bash
git clone <template> <project-dir> && cd <project-dir>
rm -rf .git && git init
pnpm install
cp .env.example .env
```

The template ships no index and a placeholder `data/sources.json` for "Example Organization"; every value in it gets replaced in Phases 3 and 4.

Then have the person add `ANTHROPIC_API_KEY` to `.env`, or write it from their shell environment without printing it.

Download the embedding model now so later steps are not interrupted. If the template checkout you copied from already has `data/models/`, reuse it instead of downloading 140 MB again by putting `RAG_MODELS_DIR=<that path>` in `.env` (the template reads `.env` before resolving paths, so this works for every command):

```bash
pnpm run prefetch-model
```

**Gate:** `pnpm -r typecheck` passes and `prefetch-model` prints the model id and dimensions in well under a minute (a long wait means it is downloading rather than reusing).

### Phase 3: Corpus

Read `references/corpus.md`. It covers the three ways content gets in and the checks that catch a bad extraction early.

**First, set the scope.** Edit the `crawl` block of `data/sources.json` so `allowPrefixes` covers the person's URLs (and `seeds` lists the pages behind each quick action if you will crawl). The importer and crawler both refuse URLs outside the prefixes, so nothing gets in until this matches. The rest of `sources.json` waits for Phase 4.

Then, by corpus type:

- **Saved files ---** HTML, PDF, Markdown, or text go in `data/import/`. Each needs its original URL: Chrome and Edge embed it in saved HTML, otherwise a `<file>.url` sidecar or `--url` on a single file. Then `pnpm run import data/import`.
- **A crawlable site ---** set `crawl.seeds` and `crawl.allowPrefixes` in `data/sources.json`, install Playwright's Chromium, then `pnpm crawl --limit 20` first to check extraction, then the full crawl.
- **A site that blocks automation ---** `pnpm crawl --source wayback` reads Internet Archive captures, labeled as archived in the UI. Or the person saves pages by hand. Never try to defeat bot protection.

Then build and inspect:

```bash
pnpm index && pnpm stats
```

**Gate:** every document the person expected is present, no document has zero chunks (open its markdown in `data/raw/md/` if one does; the extractor probably picked the wrong container), and `pnpm query "<question>"` returns the right page in the top three for at least three questions the person actually expects people to ask. Run those queries yourself and show the titles, not raw chunk text.

### Phase 4: Customize

Read `references/customizing.md`. Edit, in this order:

1. `data/sources.json`: identity (`name`, `assistantName`), `contact`, the four `copy` strings, scope, quick actions (thirteen icons available or add one), suggested questions. Quick-action `href`s should be pages that are in the index, so the button yields a cited answer.
2. The `prompt` block of `data/sources.json`: `role` (who it serves, what it covers), `neverDo` (the interview's never-do list), `declineOffer`, and optional `guidance` lines. The guardrails around them in `apps/api/src/prompt.ts` (sources only, snapshot caveat, source text is data, automatic citations, privacy) stay as they are; they are what makes the assistant safe in front of the public.
3. `apps/web/index.html` title. The rest of the UI reads from config.
4. `README.md`: replace the template's description with theirs. Keep the operational sections.

Re-run `pnpm -r typecheck` after editing. The config is validated with zod on startup, so a typo in `sources.json` shows up as a clear error, not a silent default.

### Phase 5: Run locally and have them validate

Start the API and web dev servers. If you have a browser preview tool, use `.claude/launch.json` (configs `api` on 8787 and `web` on 5173) and open the web app; otherwise run `pnpm dev` and tell them to open http://localhost:5173.

Before asking the person to look, run the smoke checks in `references/validation.md` yourself: health reports the index and `embedder: "local"`, one `POST /api/chat` returns `sources`, `delta`, `citation`, and `done` events, and an off-topic question is declined.

Then hand the person the validation checklist from that file and ask them to work through it in the browser. Wait for their verdict. Expect two or three rounds: most fixes are corpus (missing page), prompt (tone, over-refusal), or config (wrong quick-action link). Ask which it looks like before guessing.

**Gate:** the person says the assistant is good enough to show someone else. Do not move to deploy on your own judgment.

### Phase 6: Deploy when they are ready

Only when the person asks, or when they said in the interview they want it deployed and Phase 5 has passed. Read `references/deploy.md`.

You have no hosting preference. Lay out what the service needs (Node 22, a long-running process, about 1 GB of RAM to be comfortable, one secret, the committed index), name the fit for the host they already use or ask which they prefer, and then help with that one. The template includes `railway.json` for Railway and a `Dockerfile` that works on anything that runs containers. Serverless function platforms are a poor fit because of the native SQLite and ONNX modules and the in-memory model.

Before anything becomes public, go through the "before you share the URL" list in that file with them. The template has no rate limiting and no authentication; an unprotected public endpoint spends their Claude credits.

### Phase 7: Handoff

This phase happens whether or not Phase 6 did. Commit, including `data/index.sqlite`. Make sure the README says how to add documents and re-index and how to update the prompt, in their words. If they deployed, add how to redeploy for their host; if not, leave the deploy section pointing at `references/deploy.md`'s options so the decision is easy later. Tell them what is not there yet (rate limiting, scheduled re-crawl, evaluation set) so nobody is surprised later.

## Working notes

- **Secrets stay out of the transcript.** Read `.env` values into shell variables when a tool needs them. Never print `railway variables`, `.env`, or a `--json` listing that includes values.
- **The index is data, not a build artifact.** Switching embedding models means deleting `data/index.sqlite` and re-indexing; the store refuses to mix models on purpose.
- **Prefer `pnpm run <script>` over bare `pnpm <script>`** for scripts whose names collide with pnpm built-ins (`import` does).
- **Report what you verified, not what you ran.** "Health returns 13 documents" beats "started the server".
- **Stop servers by port or PID, never by pattern.** `pkill -f "tsx watch"` kills every template instance on the machine, including one the person may have running. Use `lsof -ti tcp:<port>` to find yours.
- **`CHAT_EFFORT`, not `CLAUDE_EFFORT`.** Claude Code exports `CLAUDE_EFFORT` into its shells; the template deliberately reads a different name so the harness cannot silently change the assistant's effort level.
- When something breaks, check `references/troubleshooting.md` before improvising. Most failures there have been seen once already.
