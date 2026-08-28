import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";

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
});
