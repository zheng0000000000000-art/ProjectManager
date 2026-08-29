import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompleteTaskForm } from "./complete-task-form";

vi.mock("@/features/tasks/server/actions", () => ({
  completeTaskAction: async () => ({
    message: "입력 내용을 확인해 주세요.",
    fieldErrors: { completionSummary: ["완료 결과를 입력해 주세요."] },
  }),
}));

afterEach(cleanup);

describe("CompleteTaskForm", () => {
  it("submits the task identity and version with a labeled completion summary", () => {
    render(<CompleteTaskForm taskId="task-1" expectedVersion={4} />);

    const summary = screen.getByRole("textbox", { name: "완료 결과" });
    const form = summary.closest("form") as HTMLFormElement;
    expect(summary).toHaveAttribute("name", "completionSummary");
    expect(form.elements.namedItem("taskId")).toHaveValue("task-1");
    expect(form.elements.namedItem("expectedVersion")).toHaveValue("4");
    expect(screen.getByRole("button", { name: "작업 완료" })).toBeInTheDocument();
  });

  it("shows completion validation feedback returned by the server action", async () => {
    render(<CompleteTaskForm taskId="task-1" expectedVersion={4} />);

    fireEvent.submit(screen.getByRole("button", { name: "작업 완료" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("완료 결과를 입력해 주세요.")).toHaveAttribute("role", "alert");
      expect(screen.getByText("입력 내용을 확인해 주세요.")).toHaveAttribute("role", "alert");
    });
  });
});
