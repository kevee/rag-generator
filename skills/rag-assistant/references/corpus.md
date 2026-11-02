# Getting a corpus in

Everything ends up as Markdown under `data/raw/md/` with a manifest entry in `data/raw/manifest.json` that records the URL, title, kind, fetch time, and content hash. `pnpm index` reads the manifest, chunks each document on headings (about 600 tokens, 80 overlap), embeds the chunks locally, and writes `data/index.sqlite`. Only chunks whose content changed are re-embedded, so re-indexing after a small edit is fast.

Three ways to fill `data/raw/`. Mix them freely; the manifest does not care how a page arrived.

## Path A: files the person saved or already has

Supported: `.html`, `.htm`, `.pdf`, `.md`, `.markdown`, `.txt`. Put them in `data/import/` (gitignored) and run:

```bash
pnpm run import data/import
```

Use `pnpm run import`, not `pnpm import`, because pnpm has a built-in `import` command.

**Every file needs its original URL.** The importer finds it from, in order:

1. `--url <url>` on the command line (single file only).
2. A sidecar file: `report.pdf.url` or `report.url` next to the file, holding the URL alone on one line. Windows `.url` shortcut files also work.
3. For HTML, the `<!-- saved from url=(0068)https://... -->` comment that Chrome and Edge write when you use **Save Page As**. Safari and Firefox do not write it, so their saves need a sidecar. As a last resort the importer matches the page title against links in the site's navigation, but refuses ties.

A file with no determinable URL is skipped with a message. Scope also applies: a URL outside `crawl.allowPrefixes` in `data/sources.json` is skipped unless you pass `--allow-out-of-scope`. Widen the prefixes if the corpus legitimately spans hosts.

**Saving pages well.** Ask for **Webpage, Complete** or **HTML only** from Chrome or Edge. Printing to PDF loses headings and link text, which hurts chunking and citations. A page saved while logged in may include personalised chrome; the extractor strips navigation, footers, share bars, and translate widgets by selector, but check the first few results.

**PDFs** need a text layer. Scanned PDFs are logged as "no text layer" and skipped; OCR is not in the template. For a long PDF, headings become chunk boundaries only if the PDF has real heading text, so a 60-page scan-with-OCR will chunk as a wall of text.

**Markdown and text** are indexed as-is. The first line is the title if it is a heading; otherwise the filename is. This is the path for content someone exports from a CMS, Notion, Google Docs, or writes fresh.

## Path B: a website you can crawl

Set the crawl section in `data/sources.json`:

```json
"crawl": {
  "seeds": ["https://example.org/services/"],
  "allowPrefixes": ["https://example.org/services"],
  "denyPatterns": ["[?&](print|share|lang)=", "\\.(jpe?g|png|gif|svg|webp|mp4|zip)$"],
  "documentHosts": ["example.org", "files.example.org"]
}
```

- `seeds` are where the crawl starts. Add the pages behind each quick action so they are guaranteed in.
- `allowPrefixes` is the fence. Links outside it are dropped. Start narrow.
- `denyPatterns` are regexes against the full URL; use them for print views, calendars, search result pages, and media.
- `documentHosts` lists hosts from which linked PDFs may be downloaded even if they fall outside the prefixes (CDNs, document servers).

Install the browser once, then crawl a small batch and inspect before committing to the whole site:

```bash
pnpm --filter @rag-generator/crawler exec playwright install chromium
```

```bash
pnpm crawl --limit 20
```

Open two or three files in `data/raw/md/`. You are checking that the body is the page body, not the navigation or a cookie banner, and that the title is the page title. If a site uses an unusual main-content container, add its selector to `CONTENT_SELECTORS` in `packages/crawler/src/extract/html.ts` (first match wins) and re-run with `--force`.

Then the full crawl. It is resumable: re-running fetches only new or failed pages. `--force` refetches everything.

The crawler is deliberately polite (concurrency 1, a delay between requests, backoff on 429). Do not raise `CRAWL_CONCURRENCY` against a site you do not own.

## Path C: a site that blocks automation

Government and enterprise sites often sit behind Akamai, Cloudflare, or similar and return 403 to headless browsers. Do not try to defeat that; it is their call, and workarounds tend to get an organisation's IP blocked.

Two legitimate routes:

- **Internet Archive captures.** `pnpm crawl --source wayback` lists captures for each allow prefix and fetches the most recent one per URL. Content is labeled "Archived snapshot" in the UI with a link to the capture, so users know it may be stale. The archive rate-limits hard; expect 20 minutes for 200 pages and occasional 429s that the crawler waits out.
- **Hand-saved pages** via Path A. Fifteen well-chosen pages often beat two hundred crawled ones for a focused assistant.

Also worth suggesting: the organization that owns the site may happily provide an export or allow-list a crawler if asked. That is the best route when the person building this works for or with them.

## Building and checking the index

```bash
pnpm index
```

```bash
pnpm stats
```

Stats prints documents, chunks, embeddings, the embedding model, and the last crawl time. Then look for trouble:

- **A document with zero chunks.** Compare `data/raw/manifest.json` entries against `pnpm stats`, or, if the `sqlite3` CLI is installed, query the database directly:
  ```bash
  sqlite3 data/index.sqlite "select d.title, count(c.id) from documents d left join chunks c on c.document_id=d.id group by d.id order by 2"
  ```
  Zero usually means the extractor kept too little text. Open the `.md` file and look.
- **Chunks full of HTML.** Tables are kept as HTML on purpose so Claude can read them, but if whole pages look like markup, the strip selectors missed something. Add to `STRIP_SELECTORS` in `extract/html.ts`.
- **Retrieval sanity.** For three to five questions the person expects, run:
  ```bash
  pnpm query "when is the office open"
  ```
  The right page should be in the top three with both a vector rank and a keyword rank. If only keyword hits, the chunk may be too short or the heading uninformative. If only vector hits, fine. If neither, the content is not in the corpus; go back to the person.

## Updating later

Add files or re-crawl, then `pnpm index`. Add `--prune` to drop documents that disappeared from the manifest. Commit `data/index.sqlite` when it changes; deploys read it from the repository.

## Changing the embedding model

`LOCAL_EMBED_MODEL` in `.env` accepts any Hugging Face repository with ONNX weights. Presets with the right query and document prefixes exist for nomic-embed-text, bge-small/base, and multilingual-e5-small/base; other models embed without prefixes. The store records the model and dimensions and refuses to mix them, so switching means:

```bash
rm data/index.sqlite && pnpm index
```

`EMBEDDER=voyage` plus `VOYAGE_API_KEY` switches to hosted Voyage AI embeddings if someone wants them; the local model is the default because it removes a key, a bill, and a dependency.
