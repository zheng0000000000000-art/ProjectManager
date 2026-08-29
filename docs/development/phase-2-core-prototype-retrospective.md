# Phase 2 Core Prototype 완료 기록

작성일: 2026-08-29  
상태: 검증 완료

## 결과

Phase 2의 핵심 흐름인 `작업 초안 생성 → 공개 → Ready 작업 풀 → 가져오기 → 내 작업 → 시작`이 SQLite 실제 데이터에서 닫혔다. 로그인 없이 사람 작업자와 Codex 작업자를 전환할 수 있으며, 두 작업자는 별도 사용자·프로젝트 멤버·WorkScope·작업 이력으로 기록된다. 화면과 JSON API는 동일한 명령 서비스를 사용한다.

최종 검증 결과:

- Vitest: 11개 파일, 48개 테스트 통과
- Playwright: 13개 테스트 통과
- 독립 세션 Phase 2 E2E: 3회 반복, 9개 실행 통과
- 실제 두 프로세스 SQLite 동시 가져오기: 10회 반복 통과
- ESLint: 통과
- Next.js 프로덕션 빌드 및 TypeScript 검사: 통과

## 완료 조건 감사

| Phase 2 완료 조건 | 구현 근거 | 검증 근거 | 판정 |
| --- | --- | --- | --- |
| 필수값을 채운 Task draft 공개 | `publish` 도메인 전이와 actor-aware `publishTask` | `task-transitions.test.ts`, `task-commands.test.ts`, 기존 핵심 E2E | 완료 |
| Ready 작업만 작업 풀에 표시 | 공개·open·무담당·미해결 prerequisite 없음 조건을 저장소 조회에 적용 | `sqlite-task-repository.test.ts`, Phase 2 API E2E | 완료 |
| WorkScope 불일치 거절 | actor 프로젝트 멤버십과 active scope를 take 트랜잭션 안에서 재검증 | scope/command/repository 테스트, API 거절 E2E | 완료 |
| 미완료 prerequisite 거절 | `task_prerequisites.resolved_at`이 null이면 목록 제외 및 직접 take 거절 | repository/command 테스트, API 409 E2E | 완료 |
| 같은 작업 동시 take 시 한 명만 성공 | `BEGIN IMMEDIATE` 트랜잭션과 조건부 version 갱신 | 두 독립 프로세스 경쟁 테스트 10회, 두 브라우저 경쟁 E2E | 완료 |
| take 후 My Work에 표시 | My Work가 현재 actor의 프로젝트·assignee만 조회 | 명령 테스트, 독립 세션 E2E, API E2E | 완료 |
| `taken`과 `in_progress` 구분 | 기존 분리 상태를 actor-aware 명령에서 유지 | 도메인/명령/브라우저 테스트 | 완료 |
| start 실제 시각 기록 | `started_at`과 `started` 이벤트에 같은 clock 값을 원자 저장 | 도메인/명령 테스트와 화면 표시 E2E | 완료 |
| 주요 command의 expectedVersion 처리 | 모든 mutation이 version 선검사와 `WHERE version = ?` 조건을 사용 | stale-version 명령 테스트, 동시 가져오기 테스트 | 완료 |
| 두 브라우저 또는 독립 세션 재현 | 사람·Codex 쿠키를 가진 별도 BrowserContext 사용 | `phase-2-core-prototype.spec.ts` 3회 반복 | 완료 |
| 사람과 AI가 같은 명령 경계 사용 | `createTaskCommands(repository, actor, clock)`을 서버 액션과 API가 함께 사용 | Codex API 전체 흐름 E2E 및 actor 이벤트 DB 확인 | 완료 |

## 주요 구현 결정

### 명시적 ActorContext

고정 사용자 상수를 명령 내부에서 제거하고 `{ userId, projectId, actorType }`을 명령 생성 시 주입한다. 사용자 유형은 `human | ai`로 저장되며 이벤트의 `actor_id`를 통해 누가 행동했는지 추적한다.

### 로그인 없는 작업자 전환

사이드바의 작업자 선택은 서버에서 활성 프로젝트 멤버인지 확인한 뒤 HTTP-only `project-actor` 쿠키에 저장한다. 이는 로컬 프로토타입 세션이며 운영 인증으로 간주하지 않는다. 알 수 없는 API actor 헤더는 사람 작업자로 대체하지 않고 403으로 거절한다.

### Codex JSON 경계

Codex는 `x-project-actor: user-codex` 헤더로 작업 풀·내 작업 조회와 초안 생성·공개·가져오기·시작 API를 사용할 수 있다. API route는 SQLite나 상태 전이를 직접 다루지 않고 화면 서버 액션과 같은 command/repository를 호출한다.

### 최소 prerequisite

Phase 7의 전체 dependency 기능을 앞당기지 않고, Phase 2 Ready 판정에 필요한 `task_prerequisites`와 nullable `resolved_at`만 추가했다. 편집 UI, cycle 검사, 완료 상태 연동은 후속 Phase에 남겼다.

## 문제와 해결

### 1. Node 24에서 better-sqlite3 설치 실패

증상: 시스템 기본 Node 24가 프로젝트의 `>=20.9 <24` 범위를 벗어났고, `better-sqlite3` 설치 스크립트가 C++ toolset을 요구하며 실패했다.

원인: 실행 Node 버전과 프로젝트 엔진 범위가 달랐고, 패키지 설치 스크립트가 로컬 네이티브 빌드를 시도했다.

해결: Node 22.14.0을 격리된 작업용 런타임으로 사용하고 `--ignore-scripts`로 설치한 뒤, 패키지에 포함된 Windows x64 사전 빌드 바이너리를 사용했다. 모든 검증 명령을 같은 Node 22 환경에서 실행했다.

재발 방지: `.nvmrc`와 `package.json#engines`를 기준으로 실행 환경을 먼저 확인한다. Node 24에서 네이티브 모듈을 새로 설치하지 않는다.

### 2. 실제 동시 take에서 패자가 STORAGE_ERROR로 끝남

증상: 같은 SQLite 파일을 여는 두 프로세스가 동시에 take하면 한 명은 성공하지만 다른 한 명이 `SQLITE_BUSY`를 거쳐 일반 저장 오류로 분류됐다.

원인: 기본 deferred transaction에서는 두 연결이 같은 version을 읽은 뒤 쓰기 잠금으로 승격하려 경쟁할 수 있었다.

해결: task mutation을 `BEGIN IMMEDIATE` 트랜잭션으로 시작하도록 바꿨다. 두 번째 연결은 첫 트랜잭션 완료 후 최신 version을 읽고 `VERSION_CONFLICT`로 안정적으로 거절된다.

재발 방지: 동시성 테스트는 Promise 순차 호출이 아니라 두 독립 Node 프로세스와 동일 SQLite 파일로 실행한다. 현재 테스트는 10회 반복 검증했다.

### 3. 개발 서버에서 TaskRepositoryError `instanceof` 판정 실패

증상: 단위 테스트에서는 prerequisite 오류가 정상 분류됐지만 Next.js 개발 서버 API에서는 409 대신 500을 반환했다.

근거: 진단 로그에서 오류 생성자 이름과 `code`는 정확했지만 `error instanceof TaskRepositoryError`만 false였다.

원인: 개발 서버 번들 경계에서 동일 소스의 오류 클래스가 서로 다른 클래스 identity로 로드됐다. 클래스 이름과 필드는 같아도 `instanceof`는 번들 인스턴스가 다르면 실패한다.

해결: repository 오류를 `code`와 `message`로 판정하는 구조적 type guard로 변경했다. 내부 오류 세부 사항은 여전히 노출하지 않고 알려진 code만 허용한다.

재발 방지: 서버 번들 경계를 넘는 업무 오류 분류는 `instanceof` 하나에 의존하지 않는다. 실제 개발 서버 E2E에서 HTTP status와 code를 함께 검증한다.

## 후속 범위

- 운영 인증·초대·API token
- 프로젝트 및 멤버 관리 UI
- prerequisite 편집·삭제·cycle 검사·완료 상태 자동 연동
- waiting/on_hold/review/completed 등 후속 상태
- 공용 연대표, 알림, Handoff

위 항목은 Phase 2 완료 조건에 포함하지 않았으며 기존 마일스톤 순서를 유지한다.
