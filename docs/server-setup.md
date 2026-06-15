# 서버 설정

이 문서는 GitLab Codex Reviewer를 로컬이나 서버에서 실행할 때 필요한 설정을 정리합니다. 운영 배포는 Docker Compose를 우선 권장합니다.

## 요구사항

로컬 Node 실행:

- Node.js 24 권장
- npm
- Git CLI
- Codex CLI

Docker Compose 실행:

- Docker와 Docker Compose
- GitLab OAuth application
- Reviewer Bot Token으로 사용할 GitLab Personal Access Token
- Codex에 로그인할 수 있는 OpenAI/ChatGPT 계정 또는 OpenAI Responses API 호환 서버

Docker image에는 앱 실행과 리뷰 보조 분석에 필요한 `git`, `rg`, `gitleaks`, `golangci-lint`, Go toolchain, ESLint, Codex CLI가 포함됩니다.

## 환경 변수

`.env.example`의 값만 설정하면 됩니다.

| 변수 | 예시 | 설명 |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `https://reviewer.example.com` | 사용자가 브라우저에서 접속하는 앱 origin입니다. GitLab OAuth redirect URI와 webhook URL 생성에 사용됩니다. |
| `GITLAB_BASE_URL` | `https://gitlab.com` | GitLab.com 또는 self-managed GitLab base URL입니다. |
| `GITLAB_OAUTH_CLIENT_ID` | `<Application ID>` | GitLab OAuth application의 Application ID입니다. |
| `GITLAB_OAUTH_CLIENT_SECRET` | `<Secret>` | OAuth application secret입니다. GitLab 설정에 따라 비워둘 수 있습니다. |

다음 값은 환경 변수로 설정하지 않습니다.

- SQLite DB: `.data/gitlab-codex-reviewer.sqlite`
- Codex home: `.data/codex`
- repository workspace: `.data/workspaces`
- 내부 secret: `.data/app-secrets.json`
- worker polling 주기: 5분
- 리뷰 동시성: 3
- diff/context byte limit: 앱 내부 기본값

## Docker Compose 실행

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

Compose는 `ghcr.io/doldolma/gitlab-bot:${IMAGE_TAG:-latest}` image를 사용하고 `app` 서비스 하나만 실행합니다. 컨테이너 안에서 다음 순서로 시작합니다.

1. Prisma migration 적용
2. Next.js standalone server 시작
3. worker process 시작

둘 중 하나가 종료되면 컨테이너도 종료됩니다. `restart: unless-stopped` 정책이 재시작을 맡습니다.

운영에서 release image를 고정하려면 tag를 지정합니다.

```bash
IMAGE_TAG=1.2.3 docker compose up -d
```

외부 port를 바꾸려면 `HOST_PORT`를 지정합니다.

```bash
HOST_PORT=3300 docker compose up -d
```

새 image로 갱신할 때는 pull 후 재시작합니다.

```bash
docker compose pull
docker compose up -d
```

GHCR package가 private이면 배포 서버에서 먼저 로그인합니다.

```bash
docker login ghcr.io
```

## 로컬 개발 실행

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev`는 Prisma migration을 적용한 뒤 Next.js dev server와 worker watch process를 함께 실행합니다.

개별 프로세스만 띄울 수도 있습니다.

```bash
npm run dev:web
npm run dev:worker
```

## Node 직접 운영

Docker를 쓰지 않는 운영에서는 web process와 worker process를 supervisor가 각각 관리하게 둡니다.

```bash
npm ci
npm run build
npm run start:web
npm run start:worker
```

`npm run start:web`은 시작 전에 Prisma migration을 적용합니다. `npm run start`는 web process만 실행합니다.

## Reverse Proxy

운영은 HTTPS reverse proxy 뒤에서 실행하는 것을 권장합니다.

- `PUBLIC_BASE_URL`은 외부 접속 URL과 정확히 같아야 합니다.
- GitLab OAuth Redirect URI는 `${PUBLIC_BASE_URL}/api/auth/gitlab/callback`입니다.
- GitLab webhook URL은 `${PUBLIC_BASE_URL}/api/gitlab/webhook`입니다.
- `PUBLIC_BASE_URL=http://127.0.0.1:3000`이면 브라우저도 `http://127.0.0.1:3000`으로 접속해야 합니다.

예:

```env
PUBLIC_BASE_URL=https://reviewer.example.com
GITLAB_BASE_URL=https://gitlab.example.com
```

## 데이터와 백업

`.data`는 persistent storage에 둬야 합니다. 컨테이너를 지워도 유지되어야 하는 값입니다.

백업 대상:

- `.data/gitlab-codex-reviewer.sqlite`
- `.data/app-secrets.json`
- `.data/codex`
- `.data/workspaces`

특히 `.data/app-secrets.json`은 GitLab OAuth token과 Reviewer Bot Token 복호화에 필요합니다. 잃어버리면 저장된 token을 다시 등록해야 합니다.

## GHCR image publish

GitHub에서 `v*.*.*` tag를 push하면 GitHub Actions가 Docker image를 GHCR에 publish합니다.

예를 들어 `v1.2.3` tag는 다음 image tag를 만듭니다.

- `ghcr.io/doldolma/gitlab-bot:1.2.3`
- `ghcr.io/doldolma/gitlab-bot:1.2`
- `ghcr.io/doldolma/gitlab-bot:latest`
- `ghcr.io/doldolma/gitlab-bot:sha-<shortsha>`
