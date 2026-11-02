# The interview

Ask these before touching code. Each answer changes a concrete decision later, which is noted under the question so you can explain why you are asking if the person wonders.

Use `AskUserQuestion` in two rounds when it is available. Put your recommended option first. Leave room for "Other"; these are starting points, not a form.

## Round 1: what and from where

**1. Who will use this, and about what?**
Options to offer: the general public; staff or members of one organization; a specific group (residents, students, patients, voters).
*Decides:* `prompt.role` in `data/sources.json`, how formal the tone is, and how hard the refusal guardrails need to be. A public audience gets the strictest version.

**2. What must the assistant never do?**
Free text. Prompt with examples: never recommend candidates or measures; never give legal or medical advice; never promise an outcome or waive a fee; never take an action on someone's behalf.
*Decides:* `prompt.neverDo` and `prompt.declineOffer` in `data/sources.json`, rendered as the "What you never do" section of the system prompt.

**3. What form is the content in today?**
Options: files I can save or already have (HTML, PDF, Markdown, text); a public website I can point you at; a website that blocks automated access; some of each.
*Decides:* Phase 3's path. Saved files use the importer. A crawlable site uses Playwright. A blocked site uses Internet Archive captures or hand-saved pages. Ask roughly how many pages or documents so you can set expectations for crawl time (the archive source is slow, around 200 pages in 20 minutes).

**4. Do the documents live at public URLs?**
Options: yes, every page has a public address; some do (PDFs attached to pages, for example); no, this is internal or unpublished content.
*Decides:* whether citations can link out. The importer refuses a file whose URL it cannot determine, because a citation with nowhere to go is worse than none. For unpublished content, agree on a scheme (an internal wiki URL, a shared drive link, or a stable placeholder under the organization's domain) and record it in `.url` sidecars.

## Round 2: shape and plans

**5. What are the three or four things people most need to get done?**
Free text; ask for verbs ("renew a permit", "find my polling place", "report an outage"). Suggest they look at their site's top navigation or their inbox.
*Decides:* `quickActions` in `data/sources.json`. Each becomes a button that sends a fixed question. Also ask which page answers each one, so the `href` points at something in the index.

**6. Where should people go when the assistant cannot answer?**
Need: organization name, a URL, and at least one of phone or email.
*Decides:* `contact` in `data/sources.json`, which feeds the header link, the footer, and the contact block at the bottom of the prompt. This is required: the whole safety story rests on the assistant handing off rather than guessing.

**7. What languages will people write in?**
*Decides:* a line in the prompt's style section. The embedding model is English-first but handles Romance-language queries against English documents reasonably; if the corpus itself is bilingual, say so, because `Xenova/multilingual-e5-small` may suit better and it is a one-line change plus a re-index.

**8. What is the plan for hosting?**
Options: local only for now, I just want to see it work; I want it deployed once it is validated; I need it live soon, here is the host I use.
*Decides:* whether Phase 6 is in scope today, and how to frame "done". You do not have a preference between hosts. If they name one, note it and read that section of `references/deploy.md` when the time comes.

**9. What should the project be called and where should it live?**
A short kebab-case name doubles as the directory and the `id` in `sources.json`. Default to a sibling of the current directory unless they say otherwise.

## Read it back

Summarize in five or six lines: audience and domain, the never-do list, corpus path and size, citation plan, quick actions, contact, languages, hosting intent, name. Ask for a yes. People often correct one thing here that would have cost an hour later.

## If the person is not technical

Skip jargon in the questions themselves. "Do your documents live on a website people can visit?" works better than "Do they have canonical URLs?". You can still map the answer to the same decision.
