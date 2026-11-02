# Validation

Two layers. You run the smoke checks so the person never sees a broken page. The person runs the checklist because only they know what a right answer looks like in their domain.

## Smoke checks you run

With the API up (port 8787 in dev, `PORT` in production):

```bash
curl -s http://127.0.0.1:8787/api/health
```

Expect `ok: true`, an `index` object with the document and chunk counts from `pnpm stats`, `anthropicCredentials: true`, and `embedder: "local"`. If `index` is null the server cannot find `data/index.sqlite`; if credentials are false the key is not in `.env` or the server started before it was added.

One real question through the chat endpoint:

```bash
curl -sN http://127.0.0.1:8787/api/chat -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"<a quick-action prompt>"}]}' | grep '^event:' | sort | uniq -c
```

Expect one `sources`, many `delta`, at least one `citation`, and one `done`. Zero citations with a long answer means the model answered without grounding; look at the prompt's sources section and whether the retrieved chunks actually contained the answer (the `sources` event lists them). An `error` event names its cause: `no_index`, `rate_limited`, `upstream`, `refusal`, `bad_request`.

An off-topic or forbidden question, for example the domain's equivalent of "who should I vote for". Expect a short decline that offers the escalation contact, and few or no citations.

The API log at startup should show `embedder ready: nomic-embed-text-v1.5@q8 (768 dims)` within a second or two. A multi-second load means the model cache is cold or `RAG_MODELS_DIR` points somewhere empty.

## The checklist you hand to the person

Give it to them as a short list they can tick off in the browser. Ask them to note the question and what was wrong for anything that fails, because "the drop-box answer was stale" and "it refused a normal question" lead to different fixes.

1. **Each quick-action button** gives an answer with at least one citation chip, and the chip links to the page you would have sent someone to.
2. **Your five suggested questions** each get a grounded answer or an honest "I don't have that" with the contact details, never a confident guess.
3. **One question that depends on location or account**, if the domain has those. It should ask for the missing detail or point to the official lookup tool rather than guess.
4. **One question in another language** people actually use. The answer should come back in that language.
5. **One forbidden question** from your never-do list. It should decline politely and offer something useful instead.
6. **One question whose answer you know is not in the corpus.** The assistant should say so. If it answers anyway, the prompt needs tightening or a source was retrieved that mentions the topic in passing.
7. **Citations hover and click** to the right place, and the source cards show a sensible title and capture date.
8. **On a phone-width window**, the composer, quick actions, and source cards are usable.
9. **Tone.** Would you be comfortable with this answer appearing with your organization's name next to it?

## Reading the results

Sort each failure into one bucket before fixing:

- **Corpus:** the answer exists on a page that is not indexed, or is indexed with the wrong body. Fix with import or crawl, then `pnpm index`. Most failures are here.
- **Retrieval:** the page is indexed but did not rank. Check `pnpm query` for the question. Usually the chunk's heading is uninformative or the question uses vocabulary the page does not; add the term to the quick-action prompt, or improve the page title in the markdown and re-index with `--force`.
- **Prompt:** the right chunks were retrieved (visible in the `sources` event) but the answer was wrong in tone, over-refused, or under-refused. Edit `prompt.ts`. Changing the prompt invalidates the prompt cache for one request; nothing else to do.
- **Config:** a quick-action link, label, or contact detail is wrong. `data/sources.json`.

Iterate until the person says it is good enough to show someone else. That sentence is the gate for deploying.
