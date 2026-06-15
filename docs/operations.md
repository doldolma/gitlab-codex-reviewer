# 운영 가이드

이 문서는 GitLab Codex Reviewer를 운영하면서 자주 확인하는 동작 방식과 문제 해결 방법을 정리합니다.

## 리뷰 흐름

worker는 Next.js server와 분리된 Node process입니다. Docker 배포에서는 같은 `app` 컨테이너 안에서 두 process를 함께 실행합니다.

일반 경로:

1. GitLab webhook이 MR 또는 push event를 보냅니다.
2. API route가 review job을 큐에 넣습니다.
3. worker가 job을 가져가 shared project lock을 획득합니다.
4. Reviewer Bot Token으로 GitLab MR/commit 상태와 diff를 조회합니다.
5. `.data/workspaces`에 repository를 clone/fetch하고 대상 SHA로 checkout합니다.
6. ToolRunner가 read-only 보조 분석을 실행합니다.
7. Codex가 diff와 workspace context를 바탕으로 한국어 리뷰를 생성합니다.
8. 앱이 MR summary note, MR inline comment, commit comment를 작성합니다.
9. UI에는 리뷰 상태, 이벤트 timeline, comment deep link, token 사용량, 피드백 버튼이 표시됩니다.

Webhook 누락이나 서버 downtime 복구를 위해 worker는 5분마다 fallback polling도 실행합니다.

## MR 리뷰 조건

- opened MR만 리뷰합니다.
- Draft/WIP MR은 제외합니다.
- project의 `MR 리뷰 브랜치`가 비어 있으면 MR 자동 리뷰를 하지 않습니다.
- 설정된 target branch로 들어오는 MR만 리뷰합니다.
- project별 skip label이 붙은 MR은 제외합니다.
- 같은 MR head SHA가 이미 `no_findings` 또는 `commented`면 중복 리뷰하지 않습니다.

MR diff 조회:

```text
GET /projects/:id/merge_requests/:merge_request_iid/diffs?unidiff=true
```

## Commit 리뷰 조건

- project의 `커밋 리뷰 브랜치`가 설정된 branch만 자동 리뷰합니다.
- branch를 처음 감시할 때는 최신 SHA를 baseline으로 저장하고 리뷰하지 않습니다.
- 이후 최신 SHA가 바뀌면 compare API로 새 commit 목록을 가져옵니다.
- 오래된 commit부터 순서대로 리뷰합니다.
- 같은 commit SHA가 이미 `no_findings` 또는 `commented`면 중복 리뷰하지 않습니다.
- Commit Reviews 화면에서 수동 commit review도 실행할 수 있습니다.

Commit diff 조회:

```text
GET /projects/:id/repository/commits/:sha/diff?unidiff=true
```

## 댓글 작성

MR 리뷰:

- 항상 summary note를 남깁니다.
- file과 line이 있는 주요 issue는 GitLab inline discussion으로도 남깁니다.
- 댓글에는 중복 방지 marker가 포함됩니다.
- UI의 외부 링크는 가능하면 작성된 댓글 deep link로 이동합니다.

Commit 리뷰:

- commit comment에 리뷰 요약을 남깁니다.
- GitLab commit discussions에서 note id를 찾아 `#note_<id>` deep link를 저장합니다.
- note id를 찾지 못하면 commit page link를 fallback으로 사용합니다.

## Shared Project 병합 규칙

같은 GitLab project를 여러 사용자가 등록해도 worker는 GitLab numeric project id 기준으로 한 번만 처리합니다.

- MR target branch는 사용자 subscription의 union입니다.
- Commit review branch도 union입니다.
- Skip label도 union입니다.
- 리뷰 이력과 중복 방지는 shared project 기준으로 저장됩니다.
- 각 사용자는 자기 subscription에 연결된 결과만 UI에서 봅니다.

## Project 리뷰 설정

Projects 화면에서 project별로 조정할 수 있습니다.

- 리뷰 전략: `Auto`, `빠름`, `균형`, `정밀`
- 리뷰 프로필: `Assertive`, `Chill`
- 리뷰 경로 필터: 리뷰 대상으로 포함하거나 제외할 path glob
- Path instructions: 특정 path에 적용할 리뷰 지시
- Webhook 재설정: admin만 사용

`Auto` 전략은 별도 triage 단계에서 변경 위험도를 판단한 뒤 최종 리뷰 effort를 선택합니다.

## Read-only ToolRunner

Codex 리뷰 전에 worker는 checkout workspace에서 보조 분석을 실행합니다.

- `rg-risk-scan`: hardcoded secret, broad catch, 보안 TODO 같은 위험 패턴 후보 탐색
- `gitleaks`: secret 후보를 redaction된 JSON으로 요약
- `golangci-lint`: Go repository에 설정이 있을 때 실행
- `eslint`: JS/TS repository에 설정이 있을 때 실행

ToolRunner 결과는 Codex prompt의 참고 자료입니다. 도구가 없거나 대상 repository 의존성이 부족하면 리뷰 전체를 실패시키지 않고 timeline에 skip/failed 이벤트를 남깁니다.

## UI에서 할 수 있는 일

Dashboard:

- GitLab/Codex/Reviewer Bot 상태 확인
- project 수, opened MR 수, 진행 중/실패 리뷰 수 확인
- 최근 MR 리뷰 확인
- Projects 화면으로 이동

Projects:

- 감시 project 추가/삭제
- MR 리뷰 브랜치와 커밋 리뷰 브랜치 설정
- 리뷰 전략, 리뷰 프로필, path filter, path instruction 설정
- webhook 상태 확인과 재설정

Merge Requests:

- 관측된 MR 목록 확인
- 리뷰 상태와 이벤트 timeline 확인
- 실패 리뷰 재시도, 실행 중 리뷰 취소
- GitLab MR 또는 작성된 댓글로 이동
- 리뷰 피드백 저장

Commit Reviews:

- 자동 commit review 이력 확인
- project, branch, commit을 선택해 수동 리뷰 실행
- 실패 리뷰 재시도, 실행 중 리뷰 취소
- GitLab commit 또는 작성된 댓글로 이동
- 리뷰 피드백 저장

Settings:

- GitLab OAuth redirect URI 확인
- Codex 계정/OpenAI 호환 API 선택과 전역 리뷰 모델 설정
- Reviewer Bot Token 저장, 검증, 연결 해제
- 사용자 역할 관리

## 상태 값

- `queued`: worker가 가져가길 기다리는 중
- `running`: 리뷰 실행 중
- `no_findings`: 액션 필요한 이슈 없음
- `commented`: GitLab 댓글 작성 완료
- `failed`: GitLab API, AI provider, DB 등에서 오류 발생
- `canceled`: 사용자가 취소함
- `pending`: MR은 관측됐지만 아직 리뷰 이력이 없음

## 문제 해결

### GitLab 로그인 후 callback 오류

확인할 것:

- GitLab OAuth application의 Redirect URI
- `.env`의 `PUBLIC_BASE_URL`
- 실제 브라우저 접속 origin
- reverse proxy가 `/api/auth/gitlab/callback`을 앱으로 전달하는지
- `GITLAB_OAUTH_CLIENT_ID`가 Application ID와 같은지

### Reviewer Bot Token 오류

확인할 것:

- Settings에서 Reviewer Bot Token을 저장했는지
- `Verify`가 성공하는지
- Bot 계정이 대상 project/group 멤버인지
- PAT scope에 `api`, `read_repository`가 있는지
- webhook 자동 생성을 원하면 Bot 계정이 `Maintainer` 이상인지
- self-managed GitLab에서는 token과 `GITLAB_BASE_URL`이 같은 인스턴스인지

### MR이 리뷰되지 않음

확인할 것:

- project가 enabled 상태인지
- `MR 리뷰 브랜치`가 설정되어 있는지
- MR target branch가 설정 목록에 포함되는지
- MR이 opened 상태인지
- Draft/WIP MR인지
- skip label이 붙어 있는지
- 이미 같은 head SHA로 완료된 리뷰가 있는지

### Commit이 리뷰되지 않음

확인할 것:

- project가 enabled 상태인지
- `커밋 리뷰 브랜치`에 branch가 포함되어 있는지
- branch를 처음 감시한 cycle인지
- 이미 같은 commit SHA로 완료된 리뷰가 있는지
- force-push 또는 compare 실패로 branch state가 re-baseline 되었는지

### Webhook이 생성되지 않음

확인할 것:

- Projects 화면의 Webhook 상태와 오류 메시지
- `PUBLIC_BASE_URL`이 GitLab 서버에서 접근 가능한지
- reverse proxy가 `/api/gitlab/webhook`을 앱으로 전달하는지
- HTTPS 인증서가 정상인지
- Bot 계정이 project에서 `Maintainer` 이상인지
- PAT scope에 `api`가 포함되어 있는지

### Codex 연결 실패

확인할 것:

- 현재 사용자가 `admin`인지
- `.data/codex`에 앱 실행 계정의 읽기/쓰기 권한이 있는지
- Docker에서는 `docker compose run --rm app codex login --device-auth`로 수동 로그인이 되는지
- ChatGPT 보안 설정에서 device code 인증이 허용되어 있는지

### OpenAI 호환 API 연결 테스트 실패

확인할 것:

- Base URL이 `/v1/responses`를 제공하는지
- served model name이 Settings 입력과 같은지
- 모델이 Responses API tool calling과 JSON Schema 출력을 지원하는지
- vLLM에 적절한 `--reasoning-parser`, `--enable-auto-tool-choice`, `--tool-call-parser`가 설정됐는지
- 앱 컨테이너에서 AI 서버 주소로 접근 가능한지
- `Unexpected message role` 오류라면 vLLM의 chat template와 Codex SDK가 보내는 Responses API message 형식이 호환되는지

### SQLite 또는 `.data` 권한 오류

확인할 것:

- `.data`가 존재하거나 생성 가능한지
- 앱 실행 계정이 `.data`에 쓰기 권한을 갖는지
- Docker volume이 read-only가 아닌지

## 현재 의도적으로 하지 않는 것

- 대상 repository의 테스트 실행
- 자동 코드 수정
- project별 Reviewer Bot Token override
- 사용자별 Codex 계정 분리
- 조직 전체 repository 자동 탐색
