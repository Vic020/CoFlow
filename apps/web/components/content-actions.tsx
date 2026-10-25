"use client";

import { useEffect, useState } from "react";
import { Trash2, RotateCcw } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { request, type Report, type Comment } from "@/lib/types";

export function DeleteAction({ path, updatedAt, onDeleted }: { path: string; updatedAt?: string; onDeleted: () => void }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <span className="delete-action">
    {!confirm ? <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}><Trash2 size={14}/>{t("删除")}</Button> : <>
      <span className="muted">{t("移至回收站？")}</span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { await request(path, { method: "DELETE", body: JSON.stringify({ expected_updated_at: updatedAt }) }); setConfirm(false); onDeleted(); }
        catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
      }}>{t("确认删除")}</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(false)}>{t("取消")}</Button>
    </>}
    {error && <span className="error-text" role="alert">{t(error)}</span>}
  </span>;
}

export function TrashList({ reportId, onRestored }: { reportId?: string; onRestored: () => void }) {
  const { t, date } = useI18n();
  const [items, setItems] = useState<(Report | Comment)[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const path = reportId ? `/reports/${reportId}/comments` : "/reports";
  useEffect(() => {
    let active = true;
    setLoading(true);
    request<{ items: (Report | Comment)[] }>(`${path}/trash`).then(v => { if (active) { setItems(v.items); setError(""); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path]);
  return <div className="trash-list" aria-busy={loading}>
    {error && <p className="error-text" role="alert">{t(error)}</p>}
    {loading ? <p className="muted">{t("加载中…")}</p> : !items.length && <p className="muted">{t("回收站为空")}</p>}
    {items.map(item => <div className="trash-row" key={item.id}>
      <div><p>{"title" in item ? item.title : item.body}</p><small>{item.deleted_at ? date(item.deleted_at, {dateStyle:"medium",timeStyle:"short"}) : ""}</small></div>
      <Button variant="outline" size="sm" disabled={!!busy} onClick={async () => {
        setBusy(item.id); setError("");
        try { await request(`${path}/${item.id}/restore`, { method: "POST", body: "{}" }); setItems(old => old.filter(i => i.id !== item.id)); onRestored(); }
        catch(e) { setError((e as Error).message); }
        finally { setBusy(""); }
      }}><RotateCcw size={14}/>{t("恢复")}</Button>
    </div>)}
  </div>;
}
