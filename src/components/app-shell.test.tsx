import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";

const actor = { userId: "user-codex", projectId: "project-default", actorType: "ai" as const };
afterEach(cleanup);

describe("AppShell", () => {
  it("shows the three first-version destinations", () => {
    render(
      <AppShell actor={actor}>
        <main>내용</main>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "내 작업" })).toHaveAttribute(
      "href",
      "/my-work",
    );
    expect(screen.getByRole("link", { name: "작업 풀" })).toHaveAttribute(
      "href",
      "/task-pool",
    );
    expect(screen.getByRole("link", { name: "새 작업" })).toHaveAttribute(
      "href",
      "/tasks/new",
    );
  });

  it("shows the current worker and both loginless actor choices", () => {
    render(<AppShell actor={actor}><main>내용</main></AppShell>);

    expect(screen.getByLabelText("현재 작업자")).toHaveValue("user-codex");
    expect(screen.getByRole("option", { name: "나 · 사람" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Codex · AI" })).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
  });
});
