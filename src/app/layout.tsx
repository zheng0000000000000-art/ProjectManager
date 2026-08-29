import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { getCurrentActor } from "@/features/actors/server/current-actor";
import "./globals.css";

export const metadata: Metadata = {
  title: "PROJECT · 협업 도구",
  description: "작업을 공개하고 가져와 시작하는 협업 도구",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const actor = await getCurrentActor();
  return (
    <html lang="ko">
      <body>
        <AppShell actor={actor}>{children}</AppShell>
      </body>
    </html>
  );
}
