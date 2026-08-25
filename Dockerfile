# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile
COPY . .

FROM base AS web-build
ARG FLY_API_APP=
ENV FLY_API_APP=$FLY_API_APP
RUN pnpm --filter @realm-labs/web build

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM base AS api
ENV NODE_ENV=production
ENV API_PORT=3001
EXPOSE 3001
COPY deploy/api-entrypoint.sh /app/deploy/api-entrypoint.sh
RUN sed -i 's/\r$//' /app/deploy/api-entrypoint.sh && chmod +x /app/deploy/api-entrypoint.sh
CMD ["/app/deploy/api-entrypoint.sh"]

FROM base AS worker
ENV NODE_ENV=production
ENV WORKER_HEALTH_PORT=3002
EXPOSE 3002
CMD ["pnpm", "--filter", "@realm-labs/worker", "start"]
