import { getDatabase, getTaskRepository } from "../src/db/client";
import { publish } from "../src/features/tasks/domain/task-transitions";
import { DEFAULT_PROJECT_ID } from "../src/features/scope/domain/scope";

async function seed() {
  const database = getDatabase();
  const repository = getTaskRepository();

  const count = (database.prepare("SELECT COUNT(*) count FROM tasks").get() as { count: number }).count;
  if (count === 0) {
    for (const [title, goal, workTypeId, blocks] of [
      ["사용자 흐름 정리", "핵심 사용자 여정을 간결하게 정리합니다.", "work-planning", 2],
      ["작업 카드 구현", "작업 풀에서 사용할 공통 카드를 구현합니다.", "work-development", 3],
      ["출시 전 점검", "주요 흐름과 오류 상태를 최종 확인합니다.", "work-qa", 2],
    ] as const) {
      const draft = await repository.createDraft("user-fixed", DEFAULT_PROJECT_ID);
      await repository.runCommand(draft.id, draft.version, ({ task, appendEvent }) => {
        const next = publish(task, { title, goal, workTypeId, estimatedBlocks: blocks, deadline: null });
        appendEvent({ eventType: "published", actorId: "user-fixed", fromState: "draft", toState: "published", createdAt: new Date().toISOString() });
        return next;
      });
    }
  }
  console.log("초기 데이터 준비 완료");
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
