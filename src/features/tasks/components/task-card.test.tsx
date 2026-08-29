import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskCard } from "./task-card";

const task = {
  id: "task-1", projectId: "project-default", title: "작업 카드", goal: "내용을 확인한다",
  workTypeId: "work-development", workTypeName: "개발", estimatedBlocks: 3,
  deadline: "2026-09-02", publicationState: "published" as const,
  workStatus: "open" as const, assigneeId: null, startedAt: null, version: 2,
};
afterEach(cleanup);

describe("TaskCard", () => {
  it("renders task metadata and an action slot", () => {
    render(<TaskCard task={task}><button>가져가기</button></TaskCard>);
    expect(screen.getByRole("article", { name: "작업 카드" })).toHaveTextContent("내용을 확인한다");
    expect(screen.getByText("개발")).toBeInTheDocument();
    expect(screen.getByText("3 블록")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "가져가기" })).toBeInTheDocument();
  });

  it("shows Korean status text", () => {
    render(<TaskCard task={{ ...task, workStatus: "in_progress", assigneeId: "user-fixed" }} />);
    expect(screen.getByText("진행 중")).toBeInTheDocument();
  });

  it("shows the actual start time only for an in-progress task", () => {
    const { rerender } = render(<TaskCard task={task} />);
    expect(screen.queryByText(/시작 2026/)).not.toBeInTheDocument();

    rerender(<TaskCard task={{
      ...task,
      workStatus: "in_progress",
      assigneeId: "user-codex",
      startedAt: "2026-08-29T03:04:00.000Z",
    }} />);
    expect(screen.getByText("시작 2026. 8. 29. 12:04")).toBeInTheDocument();
  });
});
