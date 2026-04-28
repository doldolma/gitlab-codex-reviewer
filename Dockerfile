# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    coreutils \
    curl \
    diffutils \
    file \
    findutils \
    gawk \
    git \
    grep \
    gzip \
    jq \
    openssh-client \
    procps \
    python3 \
    ripgrep \
    sed \
    tar \
    tini \
    unzip \
  && rm -rf /var/lib/apt/lists/*

ENV PATH=/app/node_modules/.bin:/usr/local/go/bin:$PATH

FROM golang:bookworm AS review-tools

ARG GITLEAKS_VERSION=latest
ARG GOLANGCI_LINT_VERSION=latest

RUN --mount=type=cache,target=/go/pkg/mod \
  --mount=type=cache,target=/root/.cache/go-build \
  go install github.com/zricethezav/gitleaks/v8@${GITLEAKS_VERSION} \
  && go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@${GOLANGCI_LINT_VERSION}

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
ENV GOCACHE=/app/.data/tool-cache/go-build
ENV GOMODCACHE=/app/.data/tool-cache/go-mod
ENV GOLANGCI_LINT_CACHE=/app/.data/tool-cache/golangci-lint

COPY --from=review-tools /usr/local/go /usr/local/go
COPY --from=review-tools /go/bin/gitleaks /usr/local/bin/gitleaks
COPY --from=review-tools /go/bin/golangci-lint /usr/local/bin/golangci-lint

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
  && mkdir -p \
    /app/.data/codex \
    /app/.data/workspaces \
    /app/.data/tool-cache/go-build \
    /app/.data/tool-cache/go-mod \
    /app/.data/tool-cache/golangci-lint \
  && ln -sf /usr/local/go/bin/go /usr/local/bin/go \
  && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt \
  && ln -sf /app/node_modules/.bin/eslint /usr/local/bin/eslint \
  && ln -sf /app/node_modules/.bin/codex /usr/local/bin/codex \
  && git --version \
  && rg --version \
  && go version \
  && gitleaks version \
  && golangci-lint version \
  && eslint --version \
  && codex --version \
  && chown -R node:node /app

USER node

VOLUME ["/app/.data"]
EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["node", "scripts/start-container.mjs"]
