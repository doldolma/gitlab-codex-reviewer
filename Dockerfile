# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    diffutils \
    findutils \
    git \
    jq \
    openssh-client \
    procps \
    python3 \
    ripgrep \
    tini \
  && rm -rf /var/lib/apt/lists/*

ENV PATH=/app/node_modules/.bin:$PATH

FROM base AS build

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build && rm -rf .data

FROM base AS runtime

ENV NODE_ENV=production
ENV APP_ROOT=/app
ENV HOST=0.0.0.0
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV CODEX_HOME=/app/.data/codex

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci --omit=dev \
  && npm run prisma:generate \
  && npm cache clean --force \
  && rm -rf .data

COPY --from=build /app/.next ./.next
COPY --from=build /app/dist ./dist
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json

RUN cp -R .next/static .next/standalone/.next/static \
  && mkdir -p /app/.data/codex /app/.data/workspaces \
  && chown -R node:node /app

USER node

VOLUME ["/app/.data"]
EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["npm", "run", "start:web"]
