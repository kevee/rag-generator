import { Command } from "commander";
import { buildIndex, createEmbedder, getStats, hybridSearch, loadEnv, openDb } from "@rag-generator/retrieval";
import { loadCrawlConfig } from "./config.js";
import { crawl } from "./crawl.js";
import { importFiles } from "./import.js";

loadEnv();
const program = new Command().name("rag-generator").description("Crawl, import, index, and query the assistant's corpus");

program
  .command("crawl")
  .description("Crawl the configured site into data/raw (resumable)")
  .option("-l, --limit <n>", "max pages to fetch this run", (v) => Number(v))
  .option("-f, --force", "refetch pages already in the manifest")
  .option("--headed", "run the browser with a visible window")
  .option("-s, --source <source>", "where to fetch from: live (the site itself) or wayback (Internet Archive captures)", "live")
  .action(async (opts: { limit?: number; force?: boolean; headed?: boolean; source?: string }) => {
    const cfg = loadCrawlConfig(opts);
    const report = await crawl(cfg);
    console.log(JSON.stringify(report, null, 2));
  });

program
  .command("import")
  .description("Import HTML pages or PDFs saved from your browser into data/raw (then run index)")
  .argument("<path>", "a saved .html/.pdf file, or a directory of them")
  .option("-u, --url <url>", "original URL of a single file (otherwise read from the saved-from comment or a .url sidecar)")
  .option("--allow-out-of-scope", "accept pages outside the configured crawl prefixes")
  .action(async (target: string, opts: { url?: string; allowOutOfScope?: boolean }) => {
    const cfg = loadCrawlConfig();
    const report = await importFiles(cfg, target, opts);
    console.log(JSON.stringify(report, null, 2));
  });

program
  .command("index")
  .description("Chunk, embed, and index everything in data/raw into data/index.sqlite")
  .option("-f, --force", "re-chunk and re-embed unchanged documents")
  .option("--prune", "remove indexed documents no longer present in the manifest")
  .action(async (opts: { force?: boolean; prune?: boolean }) => {
    const db = openDb();
    const embedder = await createEmbedder();
    const report = await buildIndex(db, embedder, { ...opts, log: (m) => console.log(`[index] ${m}`) });
    console.log(JSON.stringify(report, null, 2));
    console.log(JSON.stringify(getStats(db), null, 2));
    // Leave a single self-contained file so the index can be committed and deployed.
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.pragma("journal_mode = DELETE");
    db.close();
  });

program
  .command("prefetch-model")
  .description("Download the local embedding model into data/models so a deploy starts without network access")
  .action(async () => {
    const embedder = await createEmbedder();
    const probe = await embedder.embedQuery("warm up");
    console.log(`[prefetch] ${embedder.modelId} ready (${probe.length} dims)`);
  });

program
  .command("query")
  .description("Run hybrid retrieval against the index and print the top chunks")
  .argument("<text>", "question")
  .option("-k <n>", "results", (v) => Number(v), 8)
  .action(async (text: string, opts: { k: number }) => {
    const db = openDb({ readonly: true });
    const embedder = await createEmbedder();
    const results = await hybridSearch(db, embedder, text, { k: opts.k });
    for (const r of results) {
      console.log(`\n#${r.chunkId}  score=${r.score.toFixed(4)}  vec=${r.vectorRank ?? "-"}  kw=${r.keywordRank ?? "-"}`);
      const heading = r.heading.startsWith(`${r.title} > `) ? r.heading.slice(r.title.length + 3) : r.heading === r.title ? "" : r.heading;
      console.log(`${r.title}${heading ? " > " + heading : ""}`);
      console.log(r.url);
      console.log(r.text.slice(0, 300).replace(/\s+/g, " ") + (r.text.length > 300 ? "…" : ""));
    }
    db.close();
  });

program
  .command("stats")
  .description("Print index statistics")
  .action(() => {
    const db = openDb();
    console.log(JSON.stringify(getStats(db), null, 2));
    db.close();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
