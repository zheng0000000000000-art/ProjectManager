import Link from "next/link";

const destinations = [
  { href: "/my-work", label: "내 작업" },
  { href: "/task-pool", label: "작업 풀" },
  { href: "/tasks/new", label: "새 작업" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="app-brand" href="/my-work" aria-label="프로젝트 홈">
          PROJECT
        </Link>
        <nav aria-label="주요 메뉴">
          <ul className="app-nav-list">
            {destinations.map((destination) => (
              <li key={destination.href}>
                <Link className="app-nav-link" href={destination.href}>
                  {destination.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="app-project-context">
          <span>현재 프로젝트</span>
          <strong>새 프로젝트</strong>
        </div>
      </aside>
      <div className="app-workspace">{children}</div>
    </div>
  );
}
