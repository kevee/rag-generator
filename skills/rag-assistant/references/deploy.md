# Deploying

No host is preferred. Help the person deploy to the one they already use or are most comfortable operating; if they have none, lay out the options below neutrally and let them choose. The service is a single long-running Node process, which keeps every option simple.

## What the service needs, wherever it runs

| Need | Detail |
|---|---|
| Runtime | Node 22, pnpm 12 (`corepack enable` or `npm i -g pnpm@12`). |
| Build | `pnpm install --frozen-lockfile` then `pnpm run build`. The build downloads the embedding model into `data/models/` and builds the web app. About two minutes. |
| Start | `pnpm run start`. The API serves the web app from `apps/web/dist` with an SPA fallback. |
| Port | Reads `PORT`; most hosts set it. Defaults to 8787. |
| Secrets | `ANTHROPIC_API_KEY`. That is the only one. |
| Memory | About 300 MB resident on bare Node, about 550 MB measured inside the Docker image; give it 1 GB. |
| Disk | The repository plus roughly 150 MB of model weights; the Docker image is about 2.2 GB because dependencies are installed in full. No writable volume needed: the index is read-only at runtime. |
| Health | `GET /api/health` returns 200 with JSON. Use it for readiness. |
| Native modules | better-sqlite3, sqlite-vec, onnxruntime-node ship prebuilt binaries for Linux x64 and arm64. No compiler needed on glibc images. Alpine (musl) is riskier; prefer Debian-based images. |
| Not suitable | Serverless function platforms (Vercel, Netlify, Lambda) because of native modules, a 150 MB model, and per-invocation cold start. Static hosts, obviously. |

The corpus ships in the repository as `data/index.sqlite`. Updating what the assistant knows is: import or crawl, `pnpm index`, commit, redeploy.

## Options

**Railway ---** `railway up` from the project directory creates a project and deploys with Railpack, which detects pnpm and Node 22 from the repo. Set the build command to `pnpm run build`, the start command to `pnpm run start`, and the health check path to `/api/health` in the service settings or an infrastructure-as-code file. Set `ANTHROPIC_API_KEY` with `railway variable set ANTHROPIC_API_KEY --stdin` (the value piped in from the shell, never typed in chat).

**Render ---** a Web Service from the repository. Build command `pnpm install --frozen-lockfile && pnpm run build`, start command `pnpm run start`, health check path `/api/health`, instance with at least 512 MB. Node version comes from `engines` in `package.json`. Set the key in the dashboard's environment tab.

**Fly.io ---** `fly launch` detects the `Dockerfile`. Set `internal_port` to 8080 (the Dockerfile's default `PORT`), add a `[http_service]` health check on `/api/health`, scale memory to 1 GB, and `fly secrets set ANTHROPIC_API_KEY=...` from a shell variable. Pick a region near the users.

**Any container host (Cloud Run, ECS, Azure Container Apps, a VPS with Docker) ---** build the included `Dockerfile`:

```bash
docker build -t my-assistant .
```

```bash
docker run --rm -p 8080:8080 -e ANTHROPIC_API_KEY my-assistant
```

`-e ANTHROPIC_API_KEY` with no value forwards the variable from the current shell without putting it on the command line. For Cloud Run, set min instances to 1 if cold starts matter; the model loads in under a second but the container itself takes a few seconds to start.

**A plain VM ---** install Node 22, clone, `pnpm install --frozen-lockfile && pnpm run build`, run `pnpm run start` under systemd or pm2 with `ANTHROPIC_API_KEY` and `PORT` in the unit's environment, and put Caddy or nginx in front for TLS.

**Pages or static hosting for the web app alone** is possible (build `apps/web`, point `VITE` proxy at a separate API host) but adds CORS and two deploys. Only do it if the person has a reason.

## Before you share the URL

Go through this with the person. None of it is optional for a public deployment; the template leaves these out so that each organization decides.

- **Rate limiting.** There is none. Anyone can call `/api/chat` as fast as they like, and each call costs Claude tokens. Minimum: a per-IP limiter on the chat route (Hono has middleware for it) or the host's edge rate limiting (Cloudflare, Railway's, Fly's). Set a spend limit in the Claude Console as a backstop.
- **Authentication.** There is none. If the audience is staff, put it behind the organization's SSO proxy or at least HTTP basic auth at the edge.
- **Disclaimer.** The footer says the assistant can make mistakes and names the contact. Make sure that text is right and that the contact actually wants the calls.
- **Freshness.** The index is a snapshot. Agree on who re-indexes and how often, and say "last updated" somewhere if the content changes often (the `lastCrawl` field in `/api/config` is available to the UI).
- **Privacy.** Questions are sent to the Claude API. Nothing is stored by the template, but the host's request logs will contain question text in the request body only if someone adds body logging; the default Hono logger prints method, path, and status. Tell the person this plainly.
- **Cost.** With `claude-opus-5-5` at low effort and prompt caching, a typical answer runs a few thousand input tokens and under a thousand output. Ask them to set a monthly budget in the Console before going public, and consider `CLAUDE_MODEL=claude-sonnet-5-5` if volume is high and answers stay good in their validation.
- **A way to turn it off.** Make sure they know how to stop the service or remove the key on their host.

## After deploying

Verify from outside, the same way as locally: health, one chat request, one refusal. Record the public URL and the redeploy command in the README. If the host has a usage dashboard, show the person where it is.
