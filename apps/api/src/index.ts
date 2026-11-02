import { existsSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { PublicConfig } from "@rag-generator/shared";
import { getStats, listDocuments, loadAssistantConfig, repoRoot } from "@rag-generator/retrieval";
import { runChat } from "./chat.js";
import { env } from "./env.js";
import { getDb, getEmbedder, indexExists } from "./retrieve.js";

const assistant = loadAssistantConfig();
const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors({ origin: (origin) => origin ?? "*" }));

const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

function indexSummary(): PublicConfig["index"] {
  if (!indexExists()) return null;
  try {
    const s = getStats(getDb());
    return { documents: s.documents, chunks: s.chunks, lastCrawl: s.lastCrawl };
  } catch {
    return null;
  }
}

app.get("/api/health", (c) => {
  const index = indexSummary();
  return c.json({
    ok: true,
    model: env.model,
    index,
    anthropicCredentials: env.hasAnthropicCredentials,
    embedder: env.embedder,
    voyageKey: env.embedder === "voyage" ? env.hasVoyageKey : undefined,
  });
});

app.get("/api/config", (c) => {
  const body: PublicConfig = {
    organization: { id: assistant.id, name: assistant.name },
    assistantName: assistant.assistantName,
    contact: assistant.contact,
    copy: assistant.copy,
    quickActions: assistant.quickActions,
    suggestedQuestions: assistant.suggestedQuestions,
    index: indexSummary(),
  };
  return c.json(body);
});

app.get("/api/sources", (c) => {
  if (!indexExists()) return c.json({ documents: [] });
  return c.json({ documents: listDocuments(getDb()) });
});

app.post("/api/chat", async (c) => {
  const parsed = chatRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
  }
  const signal = c.req.raw.signal;
  return streamSSE(c, async (stream) => {
    let id = 0;
    for await (const event of runChat(assistant, parsed.data.messages, { signal })) {
      await stream.writeSSE({ id: String(id++), event: event.type, data: JSON.stringify(event) });
    }
  });
});

// In production the API also serves the built web app (apps/web/dist) with an SPA fallback.
const webDist = path.join(repoRoot, "apps/web/dist");
const webDistRelative = path.relative(process.cwd(), webDist) || ".";
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDistRelative }));
  app.get("*", serveStatic({ root: webDistRelative, path: "index.html" }));
  console.log(`[api] serving web app from ${webDist}`);
}

serve({ fetch: app.fetch, port: env.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[api] ${assistant.assistantName} listening on http://localhost:${info.port}`);
  console.log(`[api] model=${env.model} effort=${env.effort} index=${indexExists() ? "present" : "missing"} anthropic=${env.hasAnthropicCredentials} embedder=${env.embedder}`);
  // Load embedding weights now rather than on the first question.
  getEmbedder()
    .then((e) => console.log(`[api] embedder ready: ${e.modelId} (${e.dimensions} dims)`))
    .catch((err) => console.error(`[api] embedder failed to load: ${err instanceof Error ? err.message : err}`));
});
