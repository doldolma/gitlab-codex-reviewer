# GitLab 설정

이 문서는 GitLab OAuth application, Reviewer Bot Token, project 등록 방법을 정리합니다.

## OAuth application 생성

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

6. OAuth scope로 `api`를 선택합니다.
7. 저장 후 Application ID를 `.env`의 `GITLAB_OAUTH_CLIENT_ID`에 넣습니다.

Self-managed GitLab에서는 같은 메뉴가 사용자 프로필의 `Applications` 또는 관리자 설정의 application 영역에 있을 수 있습니다. 이 서비스에 로그인할 사용자들이 승인할 수 있는 OAuth application으로 등록되어 있어야 합니다.

## OAuth scope

현재 구현은 OAuth login에 `api` scope를 요청합니다. 사용자 OAuth token은 주로 앱 로그인, project 검색, branch 목록 조회, 사용자별 감시 설정 관리에 사용됩니다.

실제 background worker의 MR/commit 조회, repository clone/fetch/checkout, note/comment 작성은 사용자 OAuth token이 아니라 아래의 Reviewer Bot Token으로 수행합니다.

## `.env` 설정

```env
GITLAB_BASE_URL=https://gitlab.com
GITLAB_OAUTH_CLIENT_ID=<Application ID>
GITLAB_OAUTH_CLIENT_SECRET=<Secret>
PUBLIC_BASE_URL=https://reviewer.example.com
```

현재 구현은 Authorization Code + PKCE flow를 사용합니다. `GITLAB_OAUTH_CLIENT_SECRET`이 설정되어 있으면 token exchange와 refresh 요청에 함께 보냅니다. Self-managed GitLab에서 OAuth application이 confidential client로 동작하면 secret이 필요할 수 있습니다.

`PUBLIC_BASE_URL`과 GitLab OAuth Redirect URI와 실제 브라우저 접속 URL은 같은 origin이어야 합니다. 로컬에서 `PUBLIC_BASE_URL=http://127.0.0.1:3000`이면 `localhost:3000`으로 접속하지 말고 `127.0.0.1:3000`으로 접속합니다. 앱은 page 요청을 기준 origin으로 자동 redirect하지만, GitLab에 등록된 Redirect URI 자체도 기준 origin과 일치해야 합니다.

## 로그인과 사용자 분리

서버를 처음 띄운 뒤 UI에서 `Continue with GitLab`을 누르면 GitLab OAuth 로그인이 시작됩니다.

로그인에 성공한 GitLab 사용자는 앱 내부 `users` 테이블에 `gitlab_host + gitlab_user_id` 기준으로 등록됩니다. 각 사용자의 GitLab token과 project subscription 설정은 분리됩니다.

같은 GitLab project를 여러 사용자가 각각 등록할 수 있습니다. 이 경우 각 사용자는 자기 subscription 설정만 관리하지만, background worker는 같은 GitLab project를 shared project로 묶어 한 번만 조회하고 한 번만 리뷰합니다. MR note와 commit comment는 Reviewer Bot Token 계정으로 작성됩니다.

첫 GitLab 로그인 사용자는 앱 내부 `admin` 역할을 받습니다. 이후 로그인한 사용자는 기본 `user` 역할입니다.

역할별 차이:

- `admin`: Settings에서 사용자 역할을 변경하고, instance-wide Codex 연결/해제를 관리합니다.
- `user`: 자기 project, MR, review run만 관리하고 Codex 연결 상태만 확인합니다.

마지막 남은 `admin`은 `user`로 변경할 수 없습니다.

## Reviewer Bot Token

리뷰 댓글을 개인 계정이 아니라 전용 bot 계정 이름으로 남기려면 GitLab에 bot 용 일반 사용자를 하나 만들고 Personal Access Token을 발급합니다.

권장 설정:

- Bot 계정을 리뷰 대상 group/project에 `Developer` 이상으로 추가합니다.
- PAT scope는 `api`와 `read_repository`를 부여합니다.
- 전역 admin 권한은 권장하지 않습니다. 가능하면 필요한 group/project에만 멤버로 추가합니다.

앱에서 등록:

1. 앱에 `admin` 사용자로 로그인합니다.
2. `Settings` 화면의 `Reviewer Bot` 섹션으로 이동합니다.
3. 발급한 PAT를 붙여 넣고 저장합니다.
4. `Verify`로 `/api/v4/user` 검증이 성공하는지 확인합니다.

token 원문은 저장 후 다시 표시하지 않습니다. DB에는 `.data/app-secrets.json`의 암호화 키로 암호화되어 저장됩니다.

Reviewer Bot Token은 다음 작업에 사용됩니다.

- opened MR 조회
- MR diff 조회
- branch/commit/compare 조회
- repository clone/fetch/detached checkout
- MR note 작성
- commit comment 작성

## Project 등록

로그인 후 UI의 `Projects` 화면에서 감시할 GitLab project를 추가합니다.

입력값:

- Display name: UI에서 볼 이름
- GitLab project:
  - 현재 로그인 사용자의 GitLab token으로 접근 가능한 project를 검색해서 선택합니다.
  - 저장값은 안정적인 numeric project id입니다.
- Skip labels:
  - 쉼표로 구분
  - 기본 예: `skip-codex-review`
- MR target branches:
  - GitLab branch 목록에서 선택하거나 직접 입력할 수 있습니다.
  - 예: `main, develop`
  - 비워두면 opened MR 전체를 리뷰합니다.
- Commit review branches:
  - GitLab branch 목록에서 선택하거나 직접 입력할 수 있습니다.
  - 예: `main, develop, release/1.0`
  - 비워두면 commit 자동 리뷰는 실행하지 않습니다.

worker는 enabled subscription을 shared GitLab project 기준으로 묶어서 조회합니다. 같은 project를 여러 사용자가 등록해도 GitLab polling, workspace checkout, Codex 리뷰, 댓글 작성은 project당 한 번만 수행됩니다.

## MR 조회 조건

현재 worker는 GitLab API를 다음 기준으로 호출합니다.

```text
GET /projects/:id/merge_requests?state=opened&wip=no
```

`MR target branches`가 설정되어 있으면 branch별로 다음 query가 추가됩니다.

```text
target_branch=<branch>
```

따라서:

- opened MR만 대상입니다.
- Draft/WIP MR은 기본 제외됩니다.
- `MR target branches`가 설정되어 있으면 해당 target branch로 들어오는 MR만 대상입니다.
- Project별 skip label이 붙은 MR은 제외됩니다.
- MR `sha`가 없으면 GitLab diff 준비가 끝나지 않은 것으로 보고 다음 polling까지 건너뜁니다.

여러 사용자가 같은 shared project를 등록한 경우:

- `MR target branches`는 사용자 subscription 전체를 병합합니다.
- 하나라도 비어 있으면 opened MR 전체를 감시합니다.
- skip label은 전체 subscription의 union으로 적용됩니다.

## Commit 리뷰 조건

`Commit review branches`가 설정된 project만 자동 commit review 대상입니다.

- 첫 scan은 branch의 최신 SHA를 baseline으로 저장하고 리뷰하지 않습니다.
- 이후 branch 최신 SHA가 바뀌면 compare API로 새 commit 목록을 가져옵니다.
- 오래된 commit부터 diff와 workspace context 기반 리뷰를 실행합니다.
- finding이 있으면 GitLab commit comment를 작성합니다.
- finding이 없으면 DB에 `no_findings`만 기록하고 댓글은 남기지 않습니다.

테스트용으로 `Commit Reviews` 화면에서 GitLab project와 branch를 선택한 뒤 최신 commit 목록에서 commit을 고르면 감시 project가 아니어도 수동 commit review를 실행할 수 있습니다. 이때도 GitLab 조회와 댓글 작성은 Reviewer Bot Token으로 수행됩니다.
