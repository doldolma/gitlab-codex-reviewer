# GitLab Codex Reviewer

GitLab Codex Reviewer는 개인 또는 소규모 repository 관리자가 GitLab Merge Request와 branch commit의 1차 리뷰를 Codex에 맡길 수 있도록 만든 웹 기반 리뷰 자동화 도구입니다.

현재 구조는 Next.js 단일 앱입니다. React 관리 UI와 API route는 Next.js App Router 안에 있고, GitLab polling/review 실행은 별도 Node worker process로 실행합니다. GitLab OAuth 데이터는 사용자별로 분리하지만, 실제 MR/commit 조회와 댓글 작성은 관리자가 등록한 instance-wide Reviewer Bot Token으로 수행합니다. Codex 인증은 앱 루트의 `.data/codex`에 저장되는 서버 인스턴스 공용 계정을 사용합니다.

## 구성

- Next.js App Router: 관리 UI와 `/api/*` route handler
- Prisma + SQLite: 사용자, GitLab 연결, shared GitLab project, 사용자별 subscription, MR/commit review run 저장
- Worker process: shared project 단위 GitLab polling, workspace checkout, diff/context 조회, Codex 리뷰, GitLab note 작성
- GitLab OAuth: Authorization Code + PKCE, 사용자 로그인과 project/branch 선택용 token 암호화 저장
- Reviewer Bot Token: admin이 등록한 GitLab PAT로 MR/commit 조회, repository clone/fetch/checkout, note/comment 작성
- Codex auth: 앱 DB에 복사하지 않고 앱 루트 `.data/codex`의 Codex credential store 사용

## 빠른 시작

```bash
npm install
cp .env.example .env
```

`.env`에 GitLab OAuth 설정을 채운 뒤 개발 서버를 실행합니다.

```bash
npm run dev
```

기본 UI 주소:

```text
http://127.0.0.1:3000
```

운영 빌드:

```bash
npm run build
```

운영에서는 web과 worker를 별도 프로세스로 실행합니다.

```bash
npm run start:web
npm run start:worker
```

Docker Compose로 배포할 때는 web과 worker 두 서비스만 장기 실행합니다. web이 시작 전에 Prisma migration을 적용하고, worker는 web healthcheck 이후 시작합니다.

```bash
cp .env.example .env.prod
docker compose up -d --build
```

Docker 배포에서는 `.env.prod`의 `PUBLIC_BASE_URL`을 실제 접속 URL로 바꿔주세요.

SQLite DB는 별도 환경 변수 없이 `.data` volume의 기본 경로를 자동 사용합니다.

외부 포트를 바꾸려면 `HOST_PORT`를 지정합니다.

```bash
HOST_PORT=3300 docker compose up -d --build
```

## 문서

- [서버 설정](docs/server-setup.md): 런타임, 환경 변수, reverse proxy, systemd 예시
- [GitLab 설정](docs/gitlab-setup.md): OAuth app 생성, self-managed GitLab, scope, project 등록
- [Codex 설정](docs/codex-setup.md): Codex CLI, app-server 로그인, `.data/codex`
- [운영 가이드](docs/operations.md): 리뷰 흐름, UI 작업, 문제 해결

## 현재 MVP 범위

지원하는 기능:

- GitLab OAuth 기반 다중 사용자 로그인
- `admin` / `user` 역할과 admin 전용 Codex 연결 관리
- admin 전용 Reviewer Bot Token 등록/검증/해제
- 사용자별 project subscription 설정
- 같은 GitLab project를 여러 사용자가 등록해도 shared project 단위로 1회 리뷰
- opened non-draft MR polling
- MR target branch 필터링
- branch별 새 commit 자동 리뷰
- 감시 project가 아니어도 commit SHA 수동 리뷰
- project별 skip label
- MR `sha` 기준 중복 리뷰 방지
- commit SHA 기준 중복 리뷰 방지
- GitLab diff와 read-only workspace checkout context 기반 리뷰
- finding이 있을 때만 MR 일반 note 또는 commit comment 작성
- 실패 리뷰 재시도

아직 지원하지 않는 기능:

- GitLab webhook
- inline diff comment
- 테스트 실행
- 자동 코드 수정
- project별 bot token override
- 사용자별 Codex 계정 분리
