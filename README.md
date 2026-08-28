# 같이일

로그인 없이 한 명의 고정 사용자가 작업을 제안하고 함께 진행하는 첫 버전입니다.
기본 프로젝트·멤버·작업 종류·작업 범위가 SQLite에 실제 관계로 저장됩니다.

## 실행

Node.js 22 LTS를 권장합니다. Node.js 24에서는 `better-sqlite3`의 사전 빌드
바이너리가 없는 환경에서 C++ 빌드 도구를 요구할 수 있습니다.

```powershell
Copy-Item .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 구현된 흐름

1. **새 작업**에서 초안을 만듭니다.
2. 내용을 입력해 **작업 풀에 공개**합니다.
3. **작업 풀**에서 작업을 **가져가기** 합니다.
4. **내 작업**에서 **작업 시작**을 누릅니다.
5. 상태와 이력은 SQLite에 저장되어 새로고침과 앱 재시작 후에도 유지됩니다.

현재 버전은 로그인 기능이 없으며 `user-fixed` 한 명으로 동작합니다. 실행 시 기본
프로젝트와 세 가지 작업 종류(기획·개발·검수), 활성 작업 범위를 반복 실행에 안전하게
준비합니다. 작업 풀 조회와 가져오기 명령은 활성 범위가 있는 작업만 허용하며,
프로젝트 관리자도 이 검사를 우회하지 않습니다.

## Phase 1 완료 기준

- Project와 ProjectMember가 실제 데이터로 연결됩니다.
- WorkType과 MemberWorkScope를 부여하거나 회수할 수 있습니다.
- Task는 같은 프로젝트의 WorkType만 참조할 수 있습니다.
- 활성 Scope가 없는 사용자의 가져오기는 서버에서 거절됩니다.
- 서로 다른 프로젝트의 멤버·작업 종류·작업을 잘못 연결할 수 없습니다.

## 검증

```powershell
pnpm test
pnpm test:e2e
pnpm lint
pnpm build
```

브라우저 테스트를 처음 실행하는 컴퓨터에서는 `pnpm exec playwright install chromium`이 한 번 필요합니다.
