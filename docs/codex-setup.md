# Codex 설정

이 문서는 GitLab Codex Reviewer에서 Codex 계정을 연결하고 운영할 때 알아야 할 내용을 정리합니다.

## 연결 방식

Codex 인증은 앱 DB에 저장하지 않습니다. 서버 인스턴스 공용 Codex 계정 하나를 `.data/codex`에 연결해서 사용합니다.

`admin` 사용자는 Dashboard 또는 Settings에서 Codex 연결을 시작할 수 있습니다. 원격 서버와 Docker 환경에서 브라우저 callback이 막히기 쉬우므로, 앱은 기본적으로 device-code login flow를 사용합니다.

흐름:

1. 앱이 `.data/codex`를 Codex home으로 사용합니다.
2. backend가 Codex app-server의 device-code login을 시작합니다.
3. UI가 인증 URL과 user code를 보여줍니다.
4. admin이 브라우저에서 코드를 입력합니다.
5. 앱이 Codex 계정 상태를 갱신합니다.

일반 사용자는 Codex 연결 여부만 확인할 수 있습니다.

## Codex Home

Codex 인증 정보 위치:

```text
.data/codex
```

운영에서는 `.data`를 persistent volume이나 디스크에 둬야 합니다. 컨테이너나 서버를 재시작해도 Codex 로그인이 유지되어야 하기 때문입니다.

file 기반 auth를 쓰는 경우 `.data/codex/auth.json`은 비밀번호처럼 취급하세요.

## 수동 로그인

UI 연결이 실패하면 서버에서 같은 Codex home을 지정해 수동 로그인할 수 있습니다.

Node 직접 실행:

```bash
cd /opt/gitlab-codex-reviewer
CODEX_HOME="$(pwd)/.data/codex" codex login --device-auth
```

Docker Compose:

```bash
docker compose run --rm app codex login --device-auth
```

ChatGPT 보안 설정에서 Codex용 device code 인증이 꺼져 있으면 인증 페이지에서 허용 안내가 뜰 수 있습니다. 안내에 따라 허용한 뒤 다시 연결하세요.

## Docker Sandbox

로컬 Node 실행에서는 Codex review thread가 `read-only` sandbox로 실행됩니다.

Docker Compose에서는 일부 호스트에서 `bubblewrap` user namespace 생성이 막혀 Codex 도구 호출이 실패할 수 있습니다. 그래서 앱이 컨테이너 런타임을 감지하면 Codex sandbox를 `danger-full-access`로 전환합니다.

이 설정은 컨테이너 내부에만 적용됩니다. 앱은 여전히 다음 안전장치를 유지합니다.

- Codex approval policy는 `never`
- 리뷰 프롬프트는 파일 수정 금지
- checkout workspace는 project별로 분리
- 대상 repository 코드는 실행하지 않고 읽기만 사용
- 실제 격리 경계는 Docker 컨테이너와 운영 서버 권한

## 리뷰 모델

기본 리뷰 모델은 `gpt-5.5`입니다. admin은 Settings에서 전역 리뷰 모델을 바꿀 수 있습니다.

리뷰 깊이는 project별 리뷰 전략으로 결정됩니다.

- `Auto`: 변경 위험도를 먼저 판단해 적절한 reasoning effort를 선택합니다.
- `빠름`: medium effort로 빠르게 리뷰합니다.
- `균형`: high effort로 품질과 속도를 균형 있게 가져갑니다.
- `정밀`: xhigh effort로 더 깊게 리뷰합니다.

## 보안 메모

- `.data/codex`와 `.data/app-secrets.json`은 commit하지 않습니다.
- 공개 runner나 신뢰할 수 없는 서버에서 이 앱을 실행하지 않습니다.
- Codex는 GitLab diff와 checkout된 파일 context를 입력으로 받습니다.
- Reviewer Bot Token과 Codex 인증은 서버 인스턴스 권한이므로 운영 서버 접근 권한을 제한하세요.
