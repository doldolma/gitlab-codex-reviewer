# Codex 설정

이 문서는 GitLab Codex Reviewer에서 Codex 인증을 연결하는 방법을 정리합니다.

## Codex CLI 설치 확인

서버에서 Codex CLI가 실행 가능해야 합니다. 앱은 local `node_modules/.bin/codex`를 우선 사용하고, 없으면 PATH의 `codex` 명령을 사용합니다.

```bash
codex --version
```

## UI의 Connect Codex 동작 방식

`admin` 역할 사용자만 UI의 `Connect` 버튼으로 Codex 연결을 관리할 수 있습니다. 일반 사용자는 Codex 연결 여부만 확인합니다.

관리자가 `Connect` 버튼을 누르면 Next API route가 기본적으로 Codex app-server의 device-code login flow를 시작합니다. Docker와 원격 서버에서는 Codex browser login callback이 `localhost:1455`에 의존해 실패하기 쉬우므로 device-code 방식을 사용합니다.

1. 앱 루트 `.data/codex`를 Codex home으로 지정한 상태에서 `codex app-server`를 시작합니다.
2. app-server에 `account/login/start` `{ type: "chatgptDeviceCode" }` 요청을 보냅니다.
3. UI가 OpenAI device 인증 페이지와 user code를 보여줍니다.
4. 관리자가 인증 페이지에서 코드를 입력하면 backend가 `account/read`로 Codex 계정 상태를 갱신합니다.

ChatGPT 보안 설정에서 Codex용 장치 코드 인증이 꺼져 있으면 인증 페이지에서 허용 안내가 뜹니다. 이 경우 안내에 따라 장치 코드 인증을 켠 뒤 다시 `Connect`를 누릅니다.

관리자 UI에는 인증 상태, email, plan type 정도를 표시합니다. 일반 사용자 UI에는 instance-wide Codex가 연결됐는지만 표시합니다.

## Codex Home

Codex 인증 정보는 앱 DB에 복사하지 않습니다. 현재 MVP에서는 GitLab 사용자가 여러 명이어도 Codex 계정은 서버 인스턴스 공용으로 하나만 사용합니다.

Codex home은 항상 앱 실행 루트 기준 `.data/codex`입니다. `.env`에서 별도로 설정하지 않습니다.

Codex app-server와 Codex CLI는 이 경로 아래 또는 OS credential store에 인증 정보를 저장합니다. file 기반 auth를 쓰는 경우 `.data/codex/auth.json`은 비밀번호처럼 취급해야 합니다.

운영 서버에서는 앱 루트 `.data/codex`를 persistent volume에 둡니다. 컨테이너나 서버 재시작 후에도 Codex 로그인이 유지되어야 하기 때문입니다.

## 원격 서버와 headless 환경 주의사항

Codex CLI의 browser login flow는 `http://localhost:1455/auth/callback` 같은 로컬 callback을 사용할 수 있습니다. Docker 컨테이너 안에서 실행하면 이 callback listener가 컨테이너 내부 loopback에 뜰 수 있어서, 사용자의 브라우저에서 접근하지 못할 수 있습니다.

웹 UI는 이 문제를 피하기 위해 device-code login을 사용합니다.

문제가 생기면 앱 루트에서 같은 Codex home을 지정하고 수동 로그인합니다.

```bash
cd /opt/gitlab-codex-reviewer
CODEX_HOME="$(pwd)/.data/codex" codex login
```

서버에 브라우저가 없거나 callback이 막히면 Codex CLI의 device code login을 직접 사용할 수도 있습니다. 단, ChatGPT 보안 설정에서 Codex용 device code 인증이 허용되어 있어야 합니다.

```bash
cd /opt/gitlab-codex-reviewer
CODEX_HOME="$(pwd)/.data/codex" codex login --device-auth
```

Docker Compose 배포에서는 같은 `.data` volume을 사용하므로 다음 명령도 같은 Codex 인증 저장소를 사용합니다.

```bash
docker compose run --rm web codex login --device-auth
```

## Docker sandbox 동작

로컬 실행에서는 Codex review thread가 `read-only` sandbox로 실행됩니다. Docker Compose 배포에서는 일부 커널/호스트 설정에서 `bubblewrap` user namespace 생성이 막혀 Codex 도구가 전부 실패할 수 있으므로, 앱이 컨테이너 런타임을 감지하면 Codex sandbox를 `danger-full-access`로 자동 전환합니다.

이 경우에도 리뷰 프롬프트와 approval policy는 파일 수정 금지, `approvalPolicy=never`를 유지합니다. 실질적인 격리 경계는 Docker 컨테이너와 project별 workspace lock입니다.

Docker image는 Codex가 repository를 탐색할 때 자주 쓰는 `git`, `rg`, `find`, `sed`, `cat` 계열 shell 도구를 포함합니다. ToolRunner용 `gitleaks`, `golangci-lint`, 앱 번들 `eslint`도 포함되어 있어 컨테이너 배포에서도 보조 정적 분석 결과가 timeline에 남습니다.

## 보안 메모

- `.data/codex` 안의 인증 파일은 비밀번호처럼 취급합니다.
- `.env`와 `.data`는 commit하지 않습니다.
- 신뢰할 수 없는 public runner에서 이 서비스를 실행하지 않습니다.
- Codex 리뷰는 GitLab diff와 read-only workspace checkout context를 입력으로 사용합니다. checkout된 코드는 실행하지 않습니다.
