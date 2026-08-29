# 작업 카드·세부 일·우선순위 설계

- 작성일: 2026-08-29
- 상태: 구현 전 승인 설계
- 대상: ProjectManager 작업 상세와 작업 카드 도메인

## 1. 목적

연대표와 사람 중심 계획 화면을 만들기 전에 작업 카드를 완전한 실행 단위로 정리한다. 작업 카드는 사람과 AI가 동일한 구조와 권한 규칙으로 읽고 갱신할 수 있어야 한다. 첫 구현 범위는 작업 카드 정보, 계산형 우선순위, 한 단계 세부 일, 상태·권한·사용자 이벤트·내부 감사 기록이다. 일정 블록과 마일스톤은 후속 단계에서 이 구조를 참조한다.

## 2. 설계 원칙

- `Task`는 작업 카드 전체의 집합 루트다.
- `Subtask`는 독립 작업의 하위 유형이 아니라 `Task`에 포함되는 자식 객체다.
- 세부 일 계층은 한 단계만 허용한다. 더 분해해야 할 세부 일은 후속 기능에서 독립 작업 초안으로 전환한다.
- 사람과 AI는 동일한 작업·세부 일 저장 구조를 사용한다. 이번 범위의 사용자 동작은 기존 사람 중심 정책을 유지하며, 향후 AI 실행 권한을 추가할 때 `users.actor_type`과 명시적 권한 정책으로 허용 범위를 결정한다.
- 계획 일정, 작업 상태, 사용자에게 보이는 활동 기록, 내부 감사 로그를 서로 다른 데이터로 유지한다.
- 화면의 편의를 위해 도메인 규칙을 약화하지 않는다. 프로젝트 경계와 상태 전환은 서버가 검증한다.

## 3. 범위

### 포함

- 작업 카드의 목표, 설명, 마감, 예상 작업량, 담당자, 작업 종류, 상태 표시 및 변경
- 현재 우선순위 점수와 구성요소 표시
- 관리자 우선순위 조정 및 변경 이유 이력
- 세부 일 생성, 수정, 정렬, 담당자 지정, 상태 변경
- 작업·세부 일 상태 이벤트
- 명령 성공·실패 감사 기록
- 동시 수정 충돌 방지

### 제외

- 사람×시간 일정 블록과 공용 연대표
- 마일스톤 생성 및 시간축 표시
- 세부 일의 재귀적 자식
- 세부 일을 독립 작업으로 전환하는 실제 명령
- AI 자동 배정, AI 자동 실행, 생산성 평가
- 결과물 슬롯과 복잡한 검토 워크플로의 확장

## 4. 도메인 구조

```text
Task
 ├─ PriorityCurrent
 ├─ TaskPriorityAdjustment[]
 ├─ TaskPrerequisite[]
 ├─ TaskEvent[]
 ├─ Subtask[]
 │   └─ SubtaskEvent[]
 └─ Completion
```

`Task 1:N Subtask` 관계를 사용한다. `Subtask`는 항상 정확히 하나의 부모 작업을 가지며 부모와 같은 프로젝트 경계 안에 있다. 부모 작업이 보관되거나 완료되어도 세부 일과 이벤트는 삭제하지 않는다.

## 5. 저장 구조

기존 `tasks`, `task_events`, `task_prerequisites`, `audit_logs`, `users`, `project_members`를 유지하고 아래 구조를 추가한다. 실제 마이그레이션에서는 현재 SQLite 명명 규칙과 TEXT 형식의 식별자·ISO 시각 표현을 따른다.

### 5.1 priority_current

작업별 최신 계산 결과를 한 행으로 캐시한다.

- `task_id`: PK, `tasks.id` 참조
- `deadline_pressure_score`: NOT NULL
- `dependency_score`: NOT NULL
- `manager_adjustment_score`: NOT NULL
- `final_score`: NOT NULL
- `downstream_active_count`: NOT NULL
- `calculated_at`: NOT NULL
- `calculation_version`: NOT NULL

정확한 계산식과 수치 상수는 서비스 계층의 우선순위 정책에 둔다. DB는 구성요소와 결과를 보존한다. `calculation_version`은 향후 공식 변경 후 재계산을 구분한다.

### 5.2 task_priority_adjustments

관리자 조정 점수의 변경 이력을 보존한다.

- `id`: PK
- `task_id`: `tasks.id` 참조
- `previous_value`: NOT NULL
- `new_value`: NOT NULL
- `reason`: NOT NULL, 공백 불가
- `changed_by`: `users.id` 참조
- `created_at`: NOT NULL

조정값은 증분이 아니라 현재 절대값이다. 변경 명령은 조정 이력, 현재 점수 재계산, 감사 로그를 하나의 트랜잭션으로 처리한다.

### 5.3 subtasks

- `id`: PK
- `task_id`: `tasks.id` 참조, NOT NULL
- `title`: NOT NULL, 공백 불가
- `description`: NOT NULL, 기본값 빈 문자열
- `position`: NOT NULL, 0 이상의 정수
- `assignee_member_id`: `project_members.id` 참조, 선택
- `status`: `todo | in_progress | completion_requested | completed`
- `promoted_task_id`: `tasks.id` 참조, 선택, 첫 구현에서는 항상 NULL
- `version`: NOT NULL, 초기값 1
- `created_by`: `users.id` 참조
- `created_at`: NOT NULL
- `updated_at`: NOT NULL
- `completed_at`: 선택

`(task_id, position)` 조회 인덱스를 둔다. 순서 변경 시 대상 작업의 세부 일만 갱신하며 `version`으로 충돌을 감지한다. `assignee_member_id`가 가리키는 멤버는 부모 작업과 같은 프로젝트의 활성 멤버여야 한다.

### 5.4 subtask_events

- `id`: PK
- `subtask_id`: `subtasks.id` 참조
- `event_type`: NOT NULL
- `actor_id`: `users.id` 참조
- `from_state`: 선택
- `to_state`: 선택
- `metadata_json`: NOT NULL, 기본값 `{}`
- `created_at`: NOT NULL

사용자가 작업 상세에서 보는 세부 일 활동 기록이다. 실패한 시도와 내부 요청 정보는 여기에 넣지 않고 `audit_logs`에만 기록한다.

### 5.5 기존 tasks 보강

기존 `tasks.version`을 카드 기본 정보와 메인 상태의 낙관적 잠금에 계속 사용한다. 완료 요약은 현재 `completion_summary`와 `completed_at`을 유지한다. 작업 설명이 목표와 별도로 필요하므로 기존 `goal`과 구분되는 `description` 필드를 추가한다.

## 6. 우선순위 정책

최종 점수는 다음 구성요소를 합성한다.

```text
마감 압박 + 후속 작업 영향 + 관리자 조정 = 최종 우선순위 점수
```

- 마감 압박은 마감까지 남은 업무 가능 블록과 예상 작업량을 입력으로 사용한다.
- 후속 작업 영향은 이 작업을 기다리는 활성 후속 작업을 입력으로 사용한다.
- 관리자 조정에는 `priority_adjust` 권한과 이유가 필요하다.
- 마감, 예상 작업량, 의존성 또는 관리자 조정이 바뀌면 즉시 재계산한다.
- 계산 실패 시 기존 `priority_current`를 유지하고 실패 감사 로그를 남긴다.

목록과 사람별 계획 행에서 작업 카드는 다음 순서로 정렬한다.

1. `final_score` 내림차순
2. 마감이 가까운 순, 마감 없음은 마지막
3. `downstream_active_count` 내림차순
4. `tasks.created_at` 오름차순

카드 왼쪽 위의 작은 숫자 배지는 별도의 수동 순번이 아니라 `final_score`를 표시한다.

## 7. 상태와 권한

### 7.1 메인 작업

작업 카드가 목표로 하는 상태 흐름은 다음과 같다.

```text
open → taken → in_progress → review_requested → completed
                     ├→ waiting → in_progress
                     └→ on_hold → in_progress
review_requested → revision_requested → in_progress
```

- `open`에서는 공개된 미할당 작업을 가져갈 수 있다.
- `taken`에서는 담당자가 시작하거나 시작 전에 작업 풀로 돌려놓을 수 있다.
- `in_progress`에서는 대기, 보류 또는 검토 요청으로 전환할 수 있다.
- `waiting`에는 기다리는 대상, `on_hold`에는 보류 이유가 필요하다. 두 상태는 `in_progress`로 재개한다.
- `review_requested`에서는 완료 확인 또는 수정 요청만 가능하다.
- `revision_requested`는 `in_progress`로 재개한다.
- `completed`는 이 설계 범위에서 종료 상태다. 재오픈은 후속 권한 설계에 포함한다.

현재 코드의 `open | taken | in_progress | completed`는 마이그레이션 과정에서 위 상태 집합으로 확장한다. 기존의 직접 완료 명령은 호환성을 유지하되 새 작업 상세 화면의 기본 흐름은 검토 요청과 완료 확인을 사용한다.

### 7.2 세부 일

```text
todo → in_progress → completion_requested → completed
```

- 첫 구현에서는 역방향 전환을 허용하지 않는다.
- 메인 담당자가 `completion_requested`를 `completed`로 확인한다.
- 세부 일 상태가 부모 작업 상태를 자동 변경하지 않는다.
- 모든 세부 일이 완료되면 안내만 표시한다.
- 미완료 세부 일이 있어도 부모 작업의 검토 요청을 차단하지 않고 경고한다.
- 부모 작업이 완료되면 세부 일 변경을 차단한다.
- 부모 작업이 재오픈되면 변경을 다시 허용하되 세부 일 상태는 자동으로 되돌리지 않는다.

### 7.3 권한

- 작업 생성자: 공개 전 카드 기본 정보 수정
- 메인 담당자: 작업 상태 변경, 세부 일 생성·수정·정렬·담당자 지정
- 세부 일 담당자: 자신이 담당한 세부 일 상태 변경
- 메인 담당자: 세부 일 완료 요청 확인
- `priority_adjust`: 관리자 조정 점수 변경
- `completion_confirm`: 메인 작업 완료 확인

모든 요청자는 동일한 프로젝트·담당·기능 권한 검사를 통과해야 하며 `actor_type` 자체는 권한을 부여하지 않는다. 이번 구현에서 브라우저 기본 사용자는 사람이고, 기존 사람 전용 완료 제한을 유지한다. AI 계정의 상태 변경과 완료 권한은 자동 실행 기능을 설계하는 후속 범위에서 명시적으로 연다.

## 8. 명령과 트랜잭션 경계

도메인 명령은 UI와 분리한다.

- `updateTaskCard`
- `adjustTaskPriority`
- `createSubtask`
- `updateSubtask`
- `reorderSubtasks`
- `assignSubtask`
- `transitionSubtask`

각 명령은 요청자 확인, 프로젝트 경계, 권한, 현재 버전, 상태 전환을 검증한다. 성공 시 도메인 변경, 사용자 이벤트, 성공 감사 로그를 같은 트랜잭션에 저장한다. 검증 또는 저장 실패 시 도메인 데이터는 변경하지 않고 실패 감사 로그에 허용된 최소 메타데이터만 기록한다.

## 9. 작업 상세 화면

정보 배치는 다음 순서를 사용한다.

1. 우선순위 점수, 마감, 예상 작업량, 상태
2. 목표, 설명, 담당자, 작업 종류, 영역
3. 세부 일 진행 요약과 세부 일 목록
4. 의존 작업
5. 완료 요약과 결과물 진입 영역
6. 게시판·활동 기록

우선순위 점수를 선택하면 세 구성요소와 계산 시각을 펼친다. 세부 일 목록은 `position` 순서로 보여주고, 각 행에는 상태, 제목, 담당자, 현재 사용자에게 가능한 다음 행동만 표시한다. 완료된 세부 일은 접을 수 있지만 삭제하지 않는다. 사람과 AI 담당자는 같은 선택 목록을 쓰고 유형 표식만 다르게 표시한다.

## 10. 오류 처리

- 버전 불일치: 저장하지 않고 최신 카드 재조회 안내
- 권한 없음: 변경을 거부하고 허용된 행동만 노출
- 비활성 멤버 지정: 거부
- 다른 프로젝트 객체 연결: 서버에서 거부
- 완료된 부모 작업의 세부 일 수정: 거부
- 빈 제목 또는 허용되지 않은 상태 전환: 해당 입력에서 설명
- 우선순위 재계산 실패: 기존 점수 유지, 실패 감사 기록
- 이벤트 또는 감사 저장 실패: 성공 변경 전체 롤백

오류 응답은 기존 명령 결과와 HTTP 오류 매핑 패턴을 따르며 내부 감사 정보나 민감한 메타데이터를 공개 응답에 포함하지 않는다.

## 11. 검증 기준

### 도메인·저장소

- 작업 하나가 여러 세부 일을 순서대로 보존한다.
- 부모 없는 세부 일과 재귀적 세부 일을 만들 수 없다.
- 다른 프로젝트 멤버를 세부 일에 배정할 수 없다.
- 사람과 AI 담당자에 동일한 규칙이 적용된다.
- 메인 담당자와 세부 일 담당자의 권한 차이가 적용된다.
- 허용되지 않은 상태 전환이 거부된다.
- 버전 충돌이 기존 변경을 덮어쓰지 않는다.
- 점수 재계산과 동점 정렬이 정책대로 동작한다.
- 상태 이벤트와 감사 로그가 성공 변경과 원자적으로 저장된다.

### 화면·전체 흐름

- 작업 상세에서 세부 일 생성, 담당자 지정, 진행, 완료 요청, 완료가 이어진다.
- 권한에 따라 가능한 버튼만 보인다.
- 우선순위 배지와 상세 구성요소가 같은 값을 보여준다.
- 미완료 세부 일 경고와 완료된 부모 작업의 읽기 전용 상태가 동작한다.
- 데스크톱과 좁은 화면에서 중요 정보와 행동이 잘리지 않는다.

## 12. 후속 연대표 연결

작업 카드 구현 완료 후 `schedule_blocks`가 `task_id` 또는 `subtask_id`를 참조하도록 확장한다. 사람을 세로축, 시간을 가로축으로 두고 같은 사람·기간에 겹친 작업은 여러 줄로 쌓는다. 작업 카드의 `final_score`가 높은 항목을 위에 놓고 같은 값을 작은 숫자 배지로 표시한다. 마일스톤은 시간축을 관통하는 프로젝트 단위 표시점으로 별도 저장한다.
