# Phase 1 Scope Foundation 개발 기록

## 기능

로그인 없는 기본 사용자 흐름을 유지하면서 `Project`, `ProjectMember`,
`WorkType`, `MemberWorkScope`, `Task`의 실제 SQLite 관계를 구현했다.
작업 풀 조회와 가져오기 명령은 현재 멤버의 활성 작업 범위를 검사하며,
프로젝트 관리자도 범위 검사를 우회하지 않는다.

## 발생한 문제

### 기존 개발 DB와 새 스키마의 차이

기존 DB에는 `project_id` 열과 Scope 테이블이 없었다. 새 설치만 고려해
`CREATE TABLE IF NOT EXISTS`를 변경하면 이미 존재하는 테이블은 갱신되지 않는다.

### TaskRecord 계약 확장 후 빌드 실패

단위 테스트는 통과했지만 빌드의 TypeScript 검사에서 기존 fixture와 개발용 seed
스크립트가 새 `projectId` 필드를 제공하지 않아 실패했다.

### 실행 중인 개발 서버와 E2E 서버 충돌

3000번 개발 서버가 실행 중인 상태에서 E2E용 3100번 서버를 시작해도 두 서버가
같은 `.next` 디렉터리를 사용해 Next.js 잠금 충돌이 발생했다.

### E2E 데이터가 실행 사이에 누적됨

DB 초기화 파일이 Playwright 설정에 연결되지 않아 같은 제목의 카드가 여러 개
남았다. 초기화를 연결한 뒤에는 Playwright의 서버 준비 확인이 먼저 seed를 실행하고
global setup이 나중에 데이터를 지우는 순서 때문에 외래키 오류가 발생했다.

### E2E 생성물이 lint 대상에 포함됨

테스트 전용 출력 경로를 분리한 뒤 `.next-playwright` 내부의 Next.js 생성 코드까지
ESLint가 검사해 수백 개의 외부 생성물 오류를 보고했다.

### 새 체크아웃에서 Node 24 의존성 설치 실패

GitHub 작업 폴더에서 새로 설치할 때 Node 24용 `better-sqlite3` 사전 빌드가 없어
로컬 C++ 컴파일로 전환됐고, C++ 도구가 설치되지 않은 PC에서 중단됐다.

## 원인

- SQLite의 `CREATE TABLE IF NOT EXISTS`는 기존 테이블 구조를 migration하지 않는다.
- `TaskRecord`를 직접 만드는 모든 경계가 하나의 타입 계약에 의존하고 있었다.
- Next.js 개발 서버 잠금은 포트가 아니라 빌드 출력 디렉터리를 기준으로 한다.
- E2E 서버 시작, 준비 URL 확인, global setup의 실제 실행 순서를 고려하지 않았다.
- Git 제외 설정과 ESLint 제외 설정을 같은 것으로 간주했다.
- 검증된 기존 `node_modules`가 새 체크아웃의 설치 재현성을 증명하지는 않았다.

## 해결 방법

- 시작 시 열 존재 여부를 검사해 기존 DB에 `project_id`를 추가하고, 기본 프로젝트
  seed가 기존 WorkType과 Task를 같은 프로젝트로 보정하도록 했다.
- 빌드 오류가 가리킨 모든 fixture와 seed 호출을 새 `TaskRecord` 계약으로 맞췄다.
- E2E 서버에 `.next-playwright` 전용 빌드 디렉터리를 지정했다.
- Playwright `globalSetup`을 명시적으로 연결하고, 파일 삭제 대신 테스트 DB 테이블을
  비운 뒤 `seedDefaultProject`를 다시 실행하도록 했다.
- `.next-playwright/**`를 ESLint 전역 제외 경로에 명시했다.
- `.nvmrc`와 `package.json` engines에 Node 22 LTS 범위를 명시하고 README에 설치
  조건을 기록했다.

## 검증 결과

- Scope 저장소 및 명령 테스트를 포함한 단위 테스트 25개 통과
- Playwright 브라우저 테스트 9개 통과
- ESLint 통과
- Next.js production build 및 TypeScript 검사 통과
- 실행 중인 3000번 앱에서 기존 로컬 DB의 내 작업 및 작업 풀 화면 정상 표시 확인

## 다음 단계에서 재사용할 기준

- 새 테이블 정의와 기존 DB migration을 별도 문제로 취급한다.
- 도메인 record에 필드를 추가하면 직접 생성하는 fixture와 seed를 빌드로 함께 검증한다.
- 병렬 개발/E2E 서버는 포트뿐 아니라 빌드 출력과 DB 파일도 분리한다.
- E2E 초기화는 서버 실행 순서와 무관하게 최종적으로 유효한 seed 상태를 남겨야 한다.
- 별도 생성물 경로를 만들면 Git, lint, 타입 검사 대상도 함께 점검한다.
- 네이티브 의존성이 있으면 깨끗한 체크아웃과 권장 Node LTS에서 설치를 검증한다.
- UI 필터만으로 권한을 보장하지 않고 상태 변경 트랜잭션 안에서 다시 검사한다.
