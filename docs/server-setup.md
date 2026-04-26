# 서버 설정

이 문서는 GitLab Codex Reviewer를 self-hosted Node 서비스로 실행하기 위한 설정을 정리합니다.

## 런타임 요구사항

- Node.js 20.9.0 이상
  - Next.js 16의 최소 요구사항입니다.
  - DB 접근과 migration은 Prisma ORM/Prisma Migrate가 관리합니다.
- npm
- Git CLI
  - worker가 repository clone/fetch/detached checkout에 사용합니다.
- Codex CLI
  - 앱은 local `node_modules/.bin/codex`를 우선 사용하고, 없으면 PATH의 `codex` 명령을 사용합니다.

```bash
codex --version
```

## 설치와 개발 실행

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev`는 Prisma migration을 적용한 뒤 Next dev server와 worker watch process를 함께 실행합니다.

각 프로세스만 따로 실행할 수도 있습니다.

```bash
npm run dev:web
npm run dev:worker
```

## 운영 실행

운영에서는 web과 worker를 별도 프로세스로 띄웁니다. Next process 안에서 background polling을 돌리지 않습니다.

```bash
npm run build
npm run start:web
npm run start:worker
```

`npm run start:web`은 시작 전에 Prisma migration을 적용합니다. `npm run start`는 `start:web`만 실행합니다. 운영 supervisor(systemd, pm2, docker-compose 등)에서 `start:web`과 `start:worker`를 각각 관리하세요.

## Docker Compose 실행

Docker Compose 배포에서는 장기 실행 서비스가 `web`, `worker` 두 개만 뜹니다.

- `web`: 시작 전에 `npm run db:deploy`를 실행하고 Next.js standalone server를 띄웁니다.
- `worker`: `web` healthcheck가 통과한 뒤 시작해 webhook review job과 fallback polling을 처리합니다.

```bash
cp .env.example .env.prod
docker compose up -d --build
```

외부 port를 바꾸려면 `HOST_PORT`를 지정합니다. 컨테이너 내부 port는 항상 `3000`입니다.

```bash
HOST_PORT=3300 docker compose up -d --build
```

Docker image는 내부에서 `0.0.0.0:3000`으로 listen합니다. `.env.prod`에는 `PUBLIC_BASE_URL`, GitLab OAuth 값처럼 배포마다 달라지는 값만 둡니다. `.env.example`을 복사한 뒤 `PUBLIC_BASE_URL`을 실제 접속 URL로 바꿔주세요.
SQLite DB는 환경 변수로 설정하지 않으며, `.data/gitlab-codex-reviewer.sqlite` 기본 경로를 자동 사용합니다.

## 환경 변수

`.env.example`의 모든 값은 아래와 같습니다.

| 변수 | 로컬 기본값 | 운영 필요 여부 | 설명 |
| --- | --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:3000` | 필수 | 브라우저에서 접속하는 정확한 origin입니다. GitLab OAuth redirect URI 생성에 사용됩니다. |
| `GITLAB_BASE_URL` | `https://gitlab.com` | 필수 | GitLab.com 또는 self-managed GitLab base URL입니다. 예: `https://gitlab.example.com` |
| `GITLAB_OAUTH_CLIENT_ID` | 없음 | 필수 | GitLab OAuth application의 Application ID입니다. |
| `GITLAB_OAUTH_CLIENT_SECRET` | 없음 | 권장 | OAuth application secret입니다. self-managed GitLab에서 confidential client이면 필요할 수 있습니다. |
| `WORKSPACE_ROOT` | `.data/workspaces` | 선택 | worker가 GitLab repository를 project별로 clone/fetch/checkout하는 read-only workspace root입니다. |
| `MAX_DIFF_BYTES` | `200000` | 필수 | Codex에 전달할 diff 입력의 최대 byte 수입니다. |
| `MAX_CONTEXT_BYTES` | `120000` | 필수 | checkout된 workspace에서 diff 관련 파일 내용을 Codex에 추가로 전달할 최대 byte 수입니다. |

`NODE_ENV`, `HOST`, `PORT`, DB URL, 암호화 key, session secret, 리뷰 동시성, worker polling 주기는 새 설치에서 입력하지 않습니다. 로컬 web은 기본 `127.0.0.1:3000`, Docker web은 이미지 기본 `0.0.0.0:3000`을 사용합니다. DB 경로와 secret은 앱 내부 기본값/자동 생성값을 사용하고, 리뷰 job 동시성은 내부 기본값 3을 사용합니다. Worker polling 주기는 내부 기본값 5분으로 고정되어 있습니다.

`PORT`를 바꾸면 `PUBLIC_BASE_URL`의 port도 같이 바꿔야 GitLab OAuth redirect URI가 맞습니다. 실제 브라우저 접속 URL, `PUBLIC_BASE_URL`, GitLab OAuth Redirect URI는 같은 origin이어야 합니다. 앱은 다른 origin으로 들어온 page 요청을 `PUBLIC_BASE_URL` origin으로 자동 redirect합니다.

## 자동 생성되는 내부 secret

GitLab token 암호화 key와 session secret은 `.data/app-secrets.json`에 자동 생성됩니다.

```text
.data/app-secrets.json
```

이 파일은 비밀번호처럼 취급합니다. 잃어버리면 SQLite DB에 저장된 GitLab token을 복호화할 수 없어 사용자가 GitLab 로그인을 다시 해야 합니다.

운영에서는 다음을 함께 persistent storage와 백업 대상으로 둡니다.

- SQLite DB 파일
- `.data/app-secrets.json`
- `.data/codex`
- `.data/workspaces`

Reviewer Bot PAT는 SQLite DB에 암호화되어 저장됩니다. `.data/app-secrets.json`을 잃어버리면 bot token도 복호화할 수 없으므로 Settings에서 다시 등록해야 합니다.

## Reverse Proxy

운영은 HTTPS reverse proxy 뒤에 두는 것을 전제로 합니다.

- `PUBLIC_BASE_URL`은 외부 접속 URL과 정확히 같아야 합니다.
- GitLab OAuth redirect URI는 `${PUBLIC_BASE_URL}/api/auth/gitlab/callback`입니다.
- GitLab webhook URL은 `${PUBLIC_BASE_URL}/api/gitlab/webhook`입니다.
- 예를 들어 `PUBLIC_BASE_URL=http://127.0.0.1:3000`이면 `http://localhost:3000`이 아니라 `http://127.0.0.1:3000`으로 접속해야 같은 session cookie를 사용합니다.
- `.env`와 `.data`는 repository에 commit하지 않습니다.

Webhook 자동 생성과 수신을 사용하려면 `PUBLIC_BASE_URL`이 GitLab 서버에서 접근 가능한 URL이어야 합니다. 운영에서는 HTTPS를 권장합니다.

예:

```env
PUBLIC_BASE_URL=https://reviewer.example.com
GITLAB_BASE_URL=https://gitlab.example.com
```

## Prisma migration

개발 단계 기준으로 기존 legacy DB 호환 migration은 제거했습니다. 현재 schema 기준으로 새 SQLite DB를 만듭니다.

```bash
npm run db:deploy
```

앱은 Prisma 실행 전에 기본 SQLite URL을 내부에서 주입합니다. 기본 DB 파일은 repository root의 `.data/gitlab-codex-reviewer.sqlite`입니다.

## systemd 예시

아래 예시는 `/opt/gitlab-codex-reviewer`에 배포한 경우입니다.

Web:

```ini
[Unit]
Description=GitLab Codex Reviewer Web
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gitlab-codex-reviewer
EnvironmentFile=/opt/gitlab-codex-reviewer/.env
ExecStart=/usr/bin/npm run start:web
Restart=on-failure
RestartSec=5
User=gitlab-codex-reviewer
Group=gitlab-codex-reviewer

[Install]
WantedBy=multi-user.target
```

Worker:

```ini
[Unit]
Description=GitLab Codex Reviewer Worker
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gitlab-codex-reviewer
EnvironmentFile=/opt/gitlab-codex-reviewer/.env
ExecStart=/usr/bin/npm run start:worker
Restart=on-failure
RestartSec=5
User=gitlab-codex-reviewer
Group=gitlab-codex-reviewer

[Install]
WantedBy=multi-user.target
```
