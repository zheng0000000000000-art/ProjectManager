import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";

afterEach(cleanup);

describe("AppShell", () => {
  it("shows the three first-version destinations", () => {
    render(
      <AppShell>
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

  it("keeps actor switching out of the human-facing shell", () => {
    render(<AppShell><main>내용</main></AppShell>);

    expect(screen.queryByLabelText("현재 작업자")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Codex · AI" })).not.toBeInTheDocument();
  });
});
