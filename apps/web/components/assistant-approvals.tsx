"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/types";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { ContentSkeleton } from "./ui/loading-status";

type Approval = { conversation_scope: string; capability: string; target_id: string };

export function AssistantApprovals() {
  const { t } = useI18n();
  const [items, setItems] = useState<Approval[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    void request<{ items: Approval[] }>("/assistant/approvals").then((result) => {
      if (active) setItems(result.items);
    }).catch((failure: Error) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [reload]);

  const labels: Record<string, string> = {
    propose_todo: "新建任务", propose_schedule: "调整排期", propose_context: "记录到 Context",
  };
  return (
    <section className="ai-config-form" aria-label={t("动作授权")}>
      {error && <p role="alert" className="error-text">{t(error)}</p>}
      {!items && !error && <ContentSkeleton />}
      {!items && error && <Button variant="outline" onClick={() => { setError(""); setReload(reload + 1); }}>{t("重试")}</Button>}
      {items?.length === 0 && <p className="muted">{t("本空间暂无已保存的动作授权。")}</p>}
      {items?.map((item) => (
        <div className="ai-approval-row" key={JSON.stringify(item)}>
          <div>
            <strong>{t(labels[item.capability] || item.capability)} · {t(item.conversation_scope ? "本会话允许" : "始终允许")}</strong>
            <small className="muted">{item.target_id}</small>
          </div>
          <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await request("/assistant/approvals", { method: "DELETE", body: JSON.stringify(item) });
              setItems((current) => current?.filter((value) => value !== item));
            } catch (failure) { setError((failure as Error).message); }
            finally { setBusy(false); }
          }}>{t("撤销授权")}</Button>
        </div>
      ))}
    </section>
  );
}
