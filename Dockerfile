# Hermes development-friendly production image.
# The build stage runs the same recursive build used by CI, then the API and
# web targets reuse the prepared workspace for simple self-hosting.
FROM node:20-bookworm-slim AS build

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/nodes/package.json packages/nodes/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm typecheck && pnpm build

FROM build AS api
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV HERMES_WORKFLOW_STORE=/app/.data/workflows.json
RUN mkdir -p /app/.data
EXPOSE 3000
CMD ["pnpm", "start:api"]

FROM build AS web
ENV NODE_ENV=production
ENV HERMES_API_PROXY=http://api:3000
EXPOSE 5173
CMD ["pnpm", "--filter", "@hermes/web", "preview"]

