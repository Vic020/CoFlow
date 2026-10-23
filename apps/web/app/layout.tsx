import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "CoFlow · 团队动态",
  referrer: "no-referrer",
  description: "汇集团队与 Agent 的进展、交付和讨论",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
