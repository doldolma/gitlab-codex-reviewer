# GitLab AI Reviewer

GitLab AI Reviewer는 소규모 팀이 GitLab Merge Request와 branch commit의 1차 코드 리뷰를 AI에 맡길 수 있도록 만든 self-hosted 웹 앱입니다.

GitLab webhook으로 변경을 감지하고, Reviewer Bot 계정으로 diff와 repository context를 읽은 뒤, AI 리뷰 결과를 GitLab 댓글로 남깁니다. Codex 계정 또는 OpenAI Responses API 호환 서버를 인스턴스 공용 provider로 선택할 수 있습니다.

## 주요 기능

- GitLab OAuth 로그인과 사용자별 project subscription
- 첫 로그인 사용자는 `admin`, 이후 사용자는 `user` 역할로 등록
- instance-wide Reviewer Bot Token으로 GitLab 조회, checkout, 댓글 작성
- instance-wide Codex 계정 또는 OpenAI 호환 API provider
- MR review와 branch commit review 자동 실행
- GitLab webhook 우선 처리, webhook 누락 복구용 5분 fallback polling
- 같은 GitLab project를 여러 사용자가 등록해도 shared project 단위로 1회 리뷰
- MR summary note, MR inline comment, commit comment 작성
- 작성된 GitLab 댓글로 바로 이동하는 deep link 저장
- 프로젝트별 리뷰 전략: `Auto`, `빠름`, `균형`, `정밀`
- 프로젝트별 path filter와 path instruction
- 리뷰 결과에 대한 피드백 저장: 유용함, 오탐, 너무 사소함, 놓친 이슈 있음
- Docker Compose 단일 컨테이너 배포와 GHCR image publish workflow

## 동작 방식

1. 사용자가 GitLab OAuth로 로그인합니다.
2. admin이 Settings에서 Reviewer Bot Token과 AI provider를 설정합니다.
3. 사용자가 Projects에서 감시할 GitLab project와 리뷰할 branch를 등록합니다.
4. 앱이 GitLab Project Webhook을 자동 생성합니다.
5. webhook 또는 fallback polling이 MR/commit review job을 큐에 넣습니다.
6. worker process가 GitLab diff와 `.data/workspaces` checkout context를 준비합니다.
7. 선택한 AI provider가 한국어 리뷰 결과를 생성합니다.
8. 앱이 Reviewer Bot 계정으로 GitLab MR note, inline comment, commit comment를 작성합니다.

## 요구사항

- Node.js 24 권장
- npm
- Git CLI
- GitLab OAuth application
- GitLab Reviewer Bot용 Personal Access Token
- Codex에 로그인할 수 있는 OpenAI/ChatGPT 계정 또는 OpenAI Responses API와 tool calling을 지원하는 서버

Docker 배포를 사용하면 앱 실행에 필요한 Node.js, Git, Codex CLI, `rg`, `gitleaks`, `golangci-lint`, Go toolchain, ESLint가 image에 포함됩니다.

## 로컬 개발 실행

```bash
npm install
cp .env.example .env
```

`.env`를 채웁니다.

```env
PUBLIC_BASE_URL=http://127.0.0.1:3000
GITLAB_BASE_URL=https://gitlab.com
GITLAB_OAUTH_CLIENT_ID=<GitLab Application ID>
GITLAB_OAUTH_CLIENT_SECRET=<optional secret>
```

개발 서버를 실행합니다.

```bash
npm run dev
```

기본 주소는 `http://127.0.0.1:3000`입니다. `PUBLIC_BASE_URL`과 브라우저 접속 origin은 같아야 합니다. 예를 들어 기본값을 쓰면 `localhost:3000`이 아니라 `127.0.0.1:3000`으로 접속하세요.

## Docker 실행

Docker Compose는 GHCR image를 사용해 `app` 컨테이너 하나만 실행합니다. 컨테이너 시작 시 Prisma migration을 적용하고, Next.js server와 worker process를 함께 띄웁니다.

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

특정 release image를 고정하려면 `IMAGE_TAG`를 지정합니다.

```bash
IMAGE_TAG=1.2.3 docker compose up -d
```

외부 port를 바꾸려면 `HOST_PORT`를 지정합니다.

```bash
HOST_PORT=3300 docker compose up -d
```

GHCR package가 private이면 배포 서버에서 먼저 `docker login ghcr.io`를 실행해야 합니다.

## 첫 설정 순서

1. GitLab에서 OAuth application을 만들고 Redirect URI를 `${PUBLIC_BASE_URL}/api/auth/gitlab/callback`로 등록합니다.
2. `.env`에 `PUBLIC_BASE_URL`, `GITLAB_BASE_URL`, `GITLAB_OAUTH_CLIENT_ID`, 필요하면 `GITLAB_OAUTH_CLIENT_SECRET`을 입력합니다.
3. 앱을 실행한 뒤 `Continue with GitLab`로 로그인합니다.
4. 첫 로그인 사용자는 admin이 됩니다.
5. Settings에서 Codex 계정을 연결하거나 OpenAI 호환 API를 검증해 적용합니다.
6. Settings에서 Reviewer Bot Token을 저장하고 검증합니다.
7. Projects에서 GitLab project와 리뷰할 branch를 추가합니다.
8. Merge Requests 또는 Commit Reviews에서 리뷰 결과와 GitLab 댓글 링크를 확인합니다.

## 문서

- [서버 설정](docs/server-setup.md): Docker/Node 실행, 환경 변수, reverse proxy, 백업
- [GitLab 설정](docs/gitlab-setup.md): OAuth application, Reviewer Bot Token, project 등록
- [AI Provider 설정](docs/codex-setup.md): Codex 연결, OpenAI 호환 API, Qwen/vLLM, sandbox 주의사항
- [운영 가이드](docs/operations.md): 리뷰 흐름, UI 기능, 문제 해결

## 현재 의도적으로 하지 않는 것

- 대상 repository의 테스트 실행
- 자동 코드 수정
- project별 Reviewer Bot Token override
- 사용자별 AI provider 분리
- 조직 전체 repository 자동 탐색
