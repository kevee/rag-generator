# Container image for any host that runs Docker (Fly.io, Cloud Run, ECS, Azure Container Apps, a VPS).
# Buildpack-style hosts (Railway, Render) can use pnpm run build / pnpm run start directly instead.
#
#   docker build -t assistant .
#   docker run --rm -p 8080:8080 -e ANTHROPIC_API_KEY assistant
#
# Debian-based image on purpose: better-sqlite3, sqlite-vec, and onnxruntime-node ship
# glibc prebuilds for x64 and arm64, so nothing has to compile.
FROM node:22-bookworm-slim

WORKDIR /app

# pnpm via npm rather than corepack: corepack's signature keys have broken builds before.
RUN npm install -g pnpm@12.11.2 --no-fund --no-audit

# Install dependencies first so the layer is cached while source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/retrieval/package.json packages/retrieval/
COPY packages/crawler/package.json packages/crawler/
RUN pnpm install --frozen-lockfile

# Everything else, including data/index.sqlite and data/sources.json.
COPY . .

# Downloads the embedding model into data/models and builds the web app.
RUN pnpm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "run", "start"]
