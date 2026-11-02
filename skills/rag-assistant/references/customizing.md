# Customizing the template

Everything organization-specific lives in `data/sources.json`, which ships filled in for a placeholder "Example Organization". Replace every value. The web app and the system prompt have no organization-specific text of their own; they read it from config.

## 1. `data/sources.json`

Validated with zod at startup (`packages/retrieval/src/assistant-config.ts`), so a missing or misspelled field fails loudly with the path to it.

| Field | What it is | Notes |
|---|---|---|
| `id` | kebab-case identifier | Match the project name. |
| `name` | Organization or place the assistant speaks for | Used in logs and as the organization name the API reports. |
| `assistantName` | Product name | Header and browser tab. "Example City Parks Assistant". |
| `contact.name` / `url` / `phone` / `email` / `address` | Where people go when the assistant cannot answer | Required: name and url. Linked in the header, the footer, and the prompt's contact block. |
| `copy.headline` | Empty-state heading | The one question the assistant exists to answer, in the organization's voice. |
| `copy.intro` | Sentence under the heading | Say where answers come from and that they are cited. |
| `copy.disclaimer` | Footer sentence(s) | Keep "can make mistakes"; the UI appends "Confirm details with <contact>" itself. |
| `copy.refusal` | Message when the model refuses outright | Point at the contact. |
| `copy.placeholder` | Composer placeholder (optional) | Defaults to "Ask a question…". |
| `crawl.seeds` / `allowPrefixes` / `denyPatterns` / `documentHosts` | Crawl scope | See `corpus.md`. Even if you only import saved files, `allowPrefixes` must cover their URLs or the importer skips them. |
| `quickActions[]` | Buttons above the composer | `id`, `label`, `icon`, `prompt`, optional `href`. Three or four. |
| `suggestedQuestions[]` | Chips on the empty state | Five is plenty. Use the person's real questions. |

**Quick-action icons.** The web app maps icon names to lucide icons in `apps/web/src/components/chat/quick-actions.tsx`. Available out of the box: `UserRoundPlus`, `CalendarCheck`, `Inbox`, `MapPin`, `BookOpen`, `Calendar`, `CircleHelp`, `Clock`, `FileText`, `Landmark`, `Mail`, `Phone`, `Search`. Anything else falls back to an arrow. To add one, import it from `lucide-react` and add it to the `ICONS` map in that file. Pick from [lucide.dev/icons](https://lucide.dev/icons).

**Quick-action prompts.** Write the question a careful person would type, including the organization name so retrieval has a hook: "How do I reserve a picnic shelter in Example City parks, and how far ahead can I book?". The `href` is shown as "Open on the official site" on the source card; it should be a page in the index.

## 2. The `prompt` block

The system prompt is assembled in `apps/api/src/prompt.ts` from fixed guardrail text plus four fields in `sources.json`. You edit the fields, not the file.

| Field | What it is | Notes |
|---|---|---|
| `prompt.role` | Opening sentence or two | Who it serves and the topics it covers. "You are an informational assistant for patrons of Alder Creek Public Library. You help them with hours, cards, fines, room bookings, holds, and programs." |
| `prompt.neverDo[]` | The never-do list from the interview | Short clauses; each becomes a bullet under "What you never do". A public audience gets the stricter list. |
| `prompt.declineOffer` | What to offer when declining | One clause: "offer the catalog link or the branch phone number instead". |
| `prompt.guidance[]` | Optional extra lines under Style | Domain habits: "Fees are in US dollars", "Refer to patrons, not customers", "When a program has an age range, state it". |

What stays fixed, and why to tell the person so:

- **"Your only source of truth"** with the snapshot caveat and the instruction to treat source text as information rather than instructions. This is the prompt-injection defense and the anti-hallucination rule in one place.
- **"Citations"** telling the model not to write source numbers itself. Citations come from the API's document blocks; model-written `[1]` would double up and drift.
- **Style** basics: language matching with paraphrase, one statement per fact, asking for the smallest detail when an answer depends on location or account, and never collecting more personal information than needed.
- **The contact block**, generated from `contact`.

If a domain genuinely needs a different structure (a legal disclaimer paragraph, say), edit `buildSystemPrompt()` in `prompt.ts`; keep the prompt byte-stable per config so caching keeps working.

## 3. Web copy

Nothing to edit in the web code: header, subtitle, empty state, footer, and the browser tab title all come from `sources.json` through `/api/config`. `apps/web/index.html` keeps a static `<title>` for the moment before config loads; change it to the product name so the tab is right from the first paint.

To be sure nothing was missed after your edits:

```bash
grep -rn -i "example organization\|example.org" data/sources.json apps/web/index.html
```

Expect no hits.

## 4. README and environment

Rewrite the top of `README.md`: the one-paragraph description and the deploy section for their host. Keep "Getting started", "Corpus", "Configuration", and "Guardrails"; they are still true.

`.env.example` lists every variable. The only required one is `ANTHROPIC_API_KEY`. `CLAUDE_MODEL` defaults to `claude-opus-5-5`; `CHAT_EFFORT` defaults to `low` because chat is latency-sensitive and the retrieval does the hard work. `RAG_MODELS_DIR` lets several projects share one copy of the embedding weights.

## 5. Internal or non-web corpora

One thing to watch: the source-card label "Archived snapshot" versus "Fetched" assumes a web origin. For purely internal documents it still reads fine ("Fetched 2026-03-01").

After any edit here:

```bash
pnpm -r typecheck
```
