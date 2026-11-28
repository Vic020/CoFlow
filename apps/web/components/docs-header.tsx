"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CoFlowLogo } from "./coflow-logo";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";

export function DocsHeader({ page }: { page: "docs" | "cli" }) {
  const { t } = useI18n();
  return (
    <header className="docs-header">
      <Link href="/" className="docs-brand" aria-label="CoFlow">
        <CoFlowLogo />
        <strong>CoFlow</strong>
      </Link>
      <nav className="docs-header-nav" aria-label={t("文档导航")}>
        <Link href="/docs" aria-current={page === "docs" ? "page" : undefined}>Docs</Link>
        <Link href="/cli" aria-current={page === "cli" ? "page" : undefined}>CLI</Link>
      </nav>
      <Button variant="outline" size="sm" className="docs-workspace-link" asChild>
        <Link href="/todo" aria-label={t("返回工作空间")} title={t("返回工作空间")}>
          <ArrowLeft size={14} />
          <span>{t("返回工作空间")}</span>
        </Link>
      </Button>
    </header>
  );
}
