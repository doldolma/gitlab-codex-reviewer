# GitLab 설정

이 문서는 GitLab OAuth application, Reviewer Bot Token, project 등록 흐름을 설명합니다.

## 1. OAuth Application 만들기

GitLab.com 기준:

1. GitLab 우측 상단 프로필 메뉴를 엽니다.
2. `Edit profile`로 이동합니다.
3. `Access > Applications`를 엽니다.
4. `Add new application`을 선택합니다.
5. Redirect URI를 입력합니다.

```text
${PUBLIC_BASE_URL}/api/auth/gitlab/callback
```

예:

```text
https://reviewer.example.com/api/auth/gitlab/callback
```

6. Scope는 `api`를 선택합니다.
7. 저장 후 Application ID를 `.env`의 `GITLAB_OAUTH_CLIENT_ID`에 넣습니다.
8. application이 confidential client이면 secret을 `GITLAB_OAUTH_CLIENT_SECRET`에 넣습니다.

Self-managed GitLab에서는 메뉴 위치가 사용자 profile 또는 admin application 설정에 있을 수 있습니다. 앱에 로그인할 사용자가 승인할 수 있는 OAuth application으로 등록되어 있어야 합니다.

## 2. `.env` 설정

```env
PUBLIC_BASE_URL=https://reviewer.example.com
GITLAB_BASE_URL=https://gitlab.example.com
GITLAB_OAUTH_CLIENT_ID=<Application ID>
GITLAB_OAUTH_CLIENT_SECRET=<optional secret>
```

`PUBLIC_BASE_URL`, 브라우저 접속 origin, GitLab OAuth Redirect URI는 같은 origin이어야 합니다. 로컬 기본값이 `http://127.0.0.1:3000`이면 `localhost:3000`이 아니라 `127.0.0.1:3000`으로 접속하세요.

## 3. 로그인과 역할

앱에서 `Continue with GitLab`을 누르면 GitLab OAuth login이 시작됩니다.

- 첫 로그인 사용자는 앱 내부 `admin` 역할을 받습니다.
- 이후 로그인한 사용자는 기본 `user` 역할입니다.
- `admin`은 Settings에서 사용자 역할, AI provider, Reviewer Bot Token을 관리합니다.
- `user`는 자기 project와 review run을 관리하고 활성 AI provider 상태를 확인합니다.
- 마지막 남은 `admin`은 `user`로 바꿀 수 없습니다.

사용자 OAuth token은 로그인, project 검색, branch 조회, 사용자별 project subscription 관리에 사용됩니다. 실제 리뷰 실행과 GitLab 댓글 작성은 Reviewer Bot Token으로 수행합니다.

## 4. Reviewer Bot Token 만들기

리뷰 댓글을 개인 계정이 아니라 전용 bot 계정으로 남기려면 GitLab 사용자 계정을 하나 만들고 Personal Access Token을 발급합니다.

권장 설정:

- Bot 계정을 리뷰 대상 group/project에 추가합니다.
- MR/commit 조회와 댓글 작성에는 `Developer` 이상 권한이 필요합니다.
- webhook 자동 생성까지 사용하려면 대상 project에서 `Maintainer` 이상 권한이 필요합니다.
- PAT scope는 `api`와 `read_repository`를 부여합니다.
- 가능하면 필요한 group/project에만 권한을 부여하고 전역 admin 권한은 피합니다.

앱에서 등록:

1. `admin` 사용자로 로그인합니다.
2. Settings의 `Reviewer Bot` 섹션으로 이동합니다.
3. PAT를 저장합니다.
4. `Verify`로 `/api/v4/user` 검증이 성공하는지 확인합니다.

token 원문은 저장 후 다시 표시하지 않습니다. SQLite DB에는 `.data/app-secrets.json`의 암호화 키로 암호화되어 저장됩니다.

## 5. Project 등록

Projects 화면에서 감시할 GitLab project를 추가합니다.

입력값:

- GitLab project: 현재 로그인 사용자가 접근 가능한 project를 검색해 선택합니다.
- MR 리뷰 브랜치: 해당 target branch로 들어오는 opened MR만 리뷰합니다.
- 커밋 리뷰 브랜치: 해당 branch에 새 commit이 들어오면 commit 단위로 리뷰합니다.

MR 리뷰 브랜치가 비어 있으면 MR 자동 리뷰를 실행하지 않습니다. 커밋 리뷰 브랜치가 비어 있으면 commit 자동 리뷰를 실행하지 않습니다.

project 등록 시 앱은 Reviewer Bot Token으로 `${PUBLIC_BASE_URL}/api/gitlab/webhook` Project Webhook 생성을 시도합니다. 실패해도 project 등록은 성공하며, Projects 화면에서 webhook 상태와 오류를 확인할 수 있습니다.

Webhook 생성 조건:

- `PUBLIC_BASE_URL`이 GitLab 서버에서 접근 가능해야 합니다.
- 운영에서는 HTTPS를 권장합니다.
- Reviewer Bot 계정이 대상 project에서 `Maintainer` 이상이어야 합니다.
- PAT scope에 `api`가 있어야 합니다.

## 6. Webhook과 Fallback Polling

일반 경로는 webhook입니다.

- MR event가 오면 MR review job을 큐에 넣습니다.
- push event가 오면 설정된 commit review branch인지 확인한 뒤 commit review job을 큐에 넣습니다.

Webhook이 누락되거나 서버가 잠시 내려간 경우를 위해 worker는 5분마다 fallback polling도 실행합니다. fallback polling은 project 설정과 branch 설정을 기준으로 놓친 MR/commit을 다시 확인합니다.

## 7. Shared Project 규칙

같은 GitLab project를 여러 사용자가 등록할 수 있습니다.

- 각 사용자는 자기 subscription 설정만 관리합니다.
- worker는 같은 GitLab numeric project id를 shared project로 묶어 한 번만 리뷰합니다.
- MR target branch, commit review branch, skip label은 사용자 설정을 병합합니다.
- 리뷰 댓글은 Reviewer Bot 계정으로 작성됩니다.
- 각 사용자는 자기 subscription에 연결된 review 결과만 UI에서 봅니다.
