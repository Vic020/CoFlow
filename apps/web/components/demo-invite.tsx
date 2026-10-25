"use client";
import Link from "next/link";
import { LanguageSwitcher, useI18n } from "@/components/i18n-provider";
export function DemoInvite() {
  const { t } = useI18n();
  return (
    <main className="account-page">
      <LanguageSwitcher />
      <section className="account-card">
        <h1>{t("公开演示")}</h1>
        <p>
          {t("此站点不接收邀请或账号信息。请在自己的 CoFlow 实例中加入团队。")}
        </p>
        <Link href="/">{t("返回演示团队")}</Link>
      </section>
    </main>
  );
}
