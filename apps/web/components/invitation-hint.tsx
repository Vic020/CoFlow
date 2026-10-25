"use client";

import { useI18n } from "@/components/i18n-provider";
import type { InvitationInfo } from "@/lib/types";

export function InvitationHint({ info, className }: { info: InvitationInfo; className?: string }) {
  const { t } = useI18n();
  return <p className={className}>{t("{inviter} 邀请你加入，请使用 @{domain} 邮箱。", {
    inviter: info.inviter_name || t("团队成员"),
    domain: info.email_domain || info.email.slice(info.email.lastIndexOf("@") + 1),
  })}</p>;
}
