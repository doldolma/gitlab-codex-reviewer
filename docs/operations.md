# 운영 가이드

이 문서는 GitLab Codex Reviewer를 실제로 사용할 때의 동작 방식과 문제 해결 방법을 정리합니다.

## 리뷰 흐름

worker는 Next web process와 분리된 별도 Node process에서 실행됩니다. 일반 경로는 GitLab webhook이 review job을 즉시 큐에 넣고, 5분 polling은 webhook 누락이나 서버 downtime 복구용 fallback으로 유지합니다.

1. enabled project subscription을 읽고 GitLab numeric project id 기준으로 shared project group을 만듭니다.
2. Reviewer Bot Token이 연결되어 있는지 확인합니다.
3. shared project별 DB lock을 획득합니다.
4. Reviewer Bot Token으로 webhook job 또는 fallback polling 대상의 MR/commit 상태를 조회합니다.
5. MR metadata와 branch state를 shared project 기준으로 Prisma-managed SQLite DB에 저장합니다.
6. MR/commit SHA가 이미 완료된 리뷰와 같으면 건너뜁니다.
7. 새 SHA이면 GitLab diff를 가져옵니다.
8. `.data/workspaces` 아래 project workspace를 clone/fetch하고 해당 SHA로 detached checkout합니다.
9. Codex SDK에 diff와 checkout된 파일 컨텍스트를 함께 전달해 read-only review를 실행합니다.
10. actionable finding이 없으면 `no_findings`로 기록합니다.
11. Reviewer Bot Token 계정으로 MR 일반 note 또는 commit comment에 리뷰 요약을 작성합니다.

사용자 OAuth token은 로그인, project/branch 검색, 사용자별 subscription 설정 관리에만 사용합니다. worker의 GitLab API, clone/fetch/checkout, 댓글 작성은 모두 Reviewer Bot Token으로 수행합니다.

Project의 `MR target branches`가 비어 있으면 기존처럼 opened MR 전체를 조회합니다. 값이 있으면 target branch별로 조회하고 같은 MR은 `iid` 기준으로 중복 제거합니다.

Diff 조회는 다음 GitLab API를 사용합니다.

```text
GET /projects/:id/merge_requests/:merge_request_iid/diffs?unidiff=true
```

Commit review는 `Commit review branches`가 설정된 subscription이 있는 shared project에서만 자동 실행됩니다. Push webhook이 오면 branch 필터를 앱에서 확인한 뒤 commit review job을 큐에 넣습니다. fallback polling도 같은 branch 설정을 사용합니다.

1. branch의 최신 commit을 조회합니다.
2. branch 상태가 없으면 현재 최신 SHA를 baseline으로 저장하고 리뷰하지 않습니다.
3. 이후 최신 SHA가 바뀌면 `repository/compare?from=<lastSeen>&to=<latest>&straight=true`로 새 commit 목록을 가져옵니다.
4. 오래된 commit부터 commit diff를 리뷰합니다.
5. actionable finding이 없으면 `no_findings`로 기록합니다.
6. GitLab commit comment에 리뷰 요약을 작성합니다.
7. branch scan이 끝나면 성공/실패와 관계없이 `last_seen_sha`를 최신 SHA로 갱신합니다.

Commit diff 조회는 다음 GitLab API를 사용합니다.

```text
GET /projects/:id/repository/commits/:sha/diff?unidiff=true
```

## Shared Project 병합 규칙

같은 GitLab project를 여러 사용자가 등록해도 worker는 shared project 단위로 한 번만 처리합니다.

- MR target branch는 subscription 설정을 병합합니다.
- 하나라도 `MR target branches`가 비어 있으면 opened MR 전체를 감시합니다.
- Commit review branch는 비어 있지 않은 branch 목록의 union입니다.
- Skip label은 모든 subscription의 union입니다.
- 리뷰 이력과 중복 방지는 shared project 기준으로 저장됩니다.
- 각 사용자는 자기 subscription에 연결된 shared review 결과만 UI에서 봅니다.

## GitLab Webhook

Projects에서 project를 등록하면 앱은 Reviewer Bot Token으로 GitLab Project Webhook을 자동 생성합니다.

- Webhook URL은 `${PUBLIC_BASE_URL}/api/gitlab/webhook`입니다.
- `push_events`와 `merge_requests_events`를 사용합니다.
- branch 필터는 GitLab hook 설정이 아니라 앱 내부 subscription 설정으로 처리합니다.
- shared GitLab project당 hook은 하나만 유지합니다.
- hook 생성/갱신에 실패해도 fallback polling은 계속 동작합니다.

Projects 화면의 Webhook 컬럼에서 상태를 확인할 수 있습니다.

- `연결됨`: hook id와 secret이 저장되어 있습니다.
- `생성 실패`: bot 권한, URL 접근성, GitLab API 오류 등으로 hook 생성/갱신에 실패했습니다.
- `미설정`: 아직 hook 정보가 없습니다.

관리자는 Projects row의 Webhook 재설정 버튼으로 hook secret을 새로 만들고 GitLab hook을 갱신할 수 있습니다.

## 중복 댓글 방지

댓글에는 다음 marker가 포함됩니다.

```html
<!-- gitlab-codex-reviewer sha=<head_sha> -->
```

같은 MR의 같은 `sha`에 대해 이미 marker가 있으면 중복 댓글을 작성하지 않습니다.

Commit comment에는 다음 marker가 포함됩니다.

```html
<!-- gitlab-codex-reviewer commit-sha=<sha> -->
```

같은 shared project와 commit SHA에 대해 이미 `no_findings` 또는 `commented` 상태가 있으면 자동 리뷰는 건너뜁니다.

## Workspace Checkout

worker는 `WORKSPACE_ROOT` 아래 project별 workspace를 만듭니다. 기본값은 `.data/workspaces`입니다.

- workspace 디렉터리명은 `gitlab_host + numeric project id`를 해시해서 만듭니다.
- 최초 접근 시 Reviewer Bot Token으로 `git clone --no-checkout`을 수행합니다.
- 이후 scan에서는 `git fetch --prune origin` 후 MR head SHA 또는 commit SHA로 detached checkout합니다.
- Git remote URL에는 token을 저장하지 않습니다.
- checkout된 코드는 읽기만 하며 실행하지 않습니다.
- Codex prompt에는 GitLab diff와 diff에 등장한 파일의 현재 checkout 내용 일부가 포함됩니다.

## UI에서 할 수 있는 일

Dashboard:

- GitLab/Codex 인증 상태 확인
- 관리자는 Codex 연결/해제 관리
- Reviewer Bot 연결 상태 확인
- 현재 로그인한 사용자의 enabled project 수, 관측 MR 수, 실패 리뷰 수 확인
- `스캔 시작`으로 현재 로그인한 사용자 project의 fallback scan을 즉시 실행

Projects:

- 현재 로그인한 사용자의 감시 project 추가
- Webhook 연결 상태 확인
- 관리자는 project webhook 재설정
- project별 skip label 설정
- MR review 대상 target branch 설정. 비워두면 opened MR 전체를 감시합니다.
- Commit review 대상 branch 설정. 비워두면 commit 자동 리뷰는 비활성화됩니다.
- 같은 project를 다른 사용자가 등록해도 실제 리뷰 실행은 shared project 단위로 병합됩니다.
- project 삭제

Merge Requests:

- 관측된 MR 목록 확인
- 리뷰 상태 확인
- 실패한 리뷰 재시도
- GitLab MR 또는 작성된 comment로 이동

Commit Reviews:

- 감시 branch에서 자동 실행된 commit review 이력 확인
- GitLab project와 branch를 선택한 뒤 최신 commit 목록에서 commit을 골라 수동 리뷰
- 실패한 commit review 재시도
- GitLab commit 또는 작성된 comment로 이동

Settings:

- GitLab OAuth redirect URI 확인
- 현재 GitLab 사용자 확인
- GitLab host 확인
- 관리자는 Reviewer Bot Token 저장, 검증, 연결 해제
- 관리자는 사용자 목록 확인과 `admin` / `user` 역할 변경

Sidebar:

- `Sign out`으로 현재 앱 session을 종료하고 로그인 화면으로 이동

## 상태 값

주요 review status:

- `running`: 리뷰 실행 중
- `no_findings`: Codex가 actionable finding 없음으로 응답
- `commented`: finding이 있어 GitLab note 작성 완료
- `failed`: GitLab API, Codex, DB 등에서 오류 발생
- `pending`: MR은 관측됐지만 아직 리뷰 실행 이력이 없음

## 문제 해결

### GitLab 로그인 후 callback 오류

확인할 것:

- GitLab OAuth application의 Redirect URI가 정확한지
- `.env`의 `PUBLIC_BASE_URL`이 실제 접속 URL과 같은지
- reverse proxy가 `/api/auth/gitlab/callback`을 서버로 전달하는지
- `GITLAB_OAUTH_CLIENT_ID`가 Application ID와 같은지

### Reviewer Bot Token이 없거나 권한이 없음

worker와 webhook 자동 생성은 Reviewer Bot Token이 없으면 GitLab 조회, hook 관리, 댓글 작성을 수행하지 않습니다.

확인할 것:

- `admin` 사용자로 Settings의 `Reviewer Bot` 섹션에서 PAT를 등록했는지
- `Verify`가 성공하는지
- Bot 계정이 대상 project/group에 멤버로 추가되어 있는지
- Webhook 자동 생성을 원하면 Bot 계정이 대상 project에서 `Maintainer` 이상인지
- PAT scope에 `api`와 `read_repository`가 있는지
- self-managed GitLab의 `GITLAB_BASE_URL`과 token이 같은 인스턴스의 것인지

### 다른 사용자가 로그인했지만 내 project가 보이지 않음

정상 동작입니다. project subscription은 로그인한 GitLab 사용자별로 분리됩니다.

같은 GitLab project를 다른 사용자도 감시하려면 그 사용자가 직접 로그인한 뒤 `Projects` 화면에서 같은 project를 선택해야 합니다. 실제 polling과 리뷰는 shared project 기준으로 한 번만 실행됩니다.

### Codex 연결 실패

확인할 것:

- 현재 로그인 사용자가 `admin` 역할인지
- `codex --version`이 서버 계정에서 성공하는지
- local `node_modules/.bin/codex` 또는 PATH의 `codex` 명령이 실행 가능한지
- 앱 루트 `.data/codex` 디렉터리에 서버 계정이 읽기/쓰기 권한을 갖는지
- 원격/headless 환경이면 앱 루트에서 `CODEX_HOME="$(pwd)/.data/codex" codex login --device-auth`를 먼저 수행했는지

### MR이 리뷰되지 않음

확인할 것:

- Project가 UI에서 enabled 상태인지
- Reviewer Bot Token이 연결되어 있고 대상 project 접근 권한이 있는지
- `MR target branches`가 설정되어 있다면 MR의 target branch가 그 목록에 포함되는지
- MR이 opened 상태인지
- Draft/WIP MR인지
- skip label이 붙어 있는지
- GitLab API 응답의 `sha`가 아직 비어 있는지
- 이미 같은 `sha`로 `no_findings` 또는 `commented` 상태가 있는지

### Commit이 리뷰되지 않음

확인할 것:

- Project가 UI에서 enabled 상태인지
- Reviewer Bot Token이 연결되어 있고 대상 project 접근 권한이 있는지
- `Commit review branches`에 해당 branch가 포함되어 있는지
- branch를 처음 감시한 cycle인지. 첫 scan은 baseline만 저장하고 리뷰하지 않습니다.
- 이미 같은 commit SHA로 `no_findings` 또는 `commented` 상태가 있는지
- force-push 또는 compare 실패가 발생해 branch state가 re-baseline 되었는지

### Webhook이 생성되지 않음

확인할 것:

- Projects 화면의 Webhook 상태와 오류 메시지
- `PUBLIC_BASE_URL`이 GitLab 서버에서 접근 가능한 URL인지
- reverse proxy가 `/api/gitlab/webhook`을 web process로 전달하는지
- 운영 환경에서 HTTPS 인증서가 정상인지
- Reviewer Bot 계정이 대상 project에서 `Maintainer` 이상인지
- PAT scope에 `api`가 포함되어 있는지
- self-managed GitLab에서 outbound webhook 요청이 내부망/방화벽에 막히지 않는지

### Workspace checkout 오류

확인할 것:

- 서버에 `git` 명령이 설치되어 있는지
- `WORKSPACE_ROOT`에 worker 실행 계정의 읽기/쓰기 권한이 있는지
- Bot 계정에 `read_repository` 권한이 있는지
- project의 HTTP clone URL을 GitLab API가 반환하는지
- force-push 등으로 리뷰 대상 SHA가 더 이상 fetch 가능한 commit인지

### GitLab OAuth token 만료 또는 API 오류

앱은 사용자별로 저장된 OAuth refresh token으로 access token 갱신을 시도합니다. 이 token은 UI project/branch 검색과 로그인 상태에 사용됩니다. 계속 실패하면 해당 사용자가 UI에서 GitLab logout 후 다시 로그인합니다.

### SQLite/Prisma 권한 오류

확인할 것:

- 기본 SQLite 파일 `.data/gitlab-codex-reviewer.sqlite`의 상위 디렉터리가 존재하거나 생성 가능한지
- 서버 실행 계정이 `.data` 디렉터리에 쓰기 권한을 갖는지
- 운영 배포에서 `.data`가 read-only image 안에 있지 않은지

## 현재 의도적으로 하지 않는 것

- MR inline comment 작성
- 테스트 실행
- 자동 코드 수정
- 조직 전체 repository 자동 탐색
- project별 bot token override
- 사용자별 Codex 계정 분리
