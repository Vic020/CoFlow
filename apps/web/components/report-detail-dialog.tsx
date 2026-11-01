"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import {
  request,
  type Meta,
  type Report,
  type Collaboration,
} from "@/lib/types";
import { useI18n } from "./i18n-provider";
import { ReportDetail } from "./report-detail";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

export function ReportDetailDialog({
  reportId,
  meta,
  onClose,
  onChange,
}: {
  reportId: string;
  meta: Meta;
  onClose: () => void;
  onChange: () => void;
}) {
  const { t: tr } = useI18n();
  const [report, setReport] = useState<Report | null>(null);
  const [collaborations, setCollaborations] = useState<Collaboration[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    // Details and discussion are always read fresh, independent of the Calendar snapshot.
    void Promise.allSettled([
      request<Report>(`/reports/${encodeURIComponent(reportId)}`),
      meta.mode === "local-demo"
        ? Promise.resolve({ items: [] as Collaboration[] })
        : request<{ items: Collaboration[] }>("/collaborations"),
    ]).then(([detail, requests]) => {
      if (!current) return;
      if (detail.status === "fulfilled") setReport(detail.value);
      else {
        setReport(null);
        setError(detail.reason.message);
      }
      if (requests.status === "fulfilled")
        setCollaborations(
          requests.value.items.filter((c) => c.report_id === reportId),
        );
      else setError(requests.reason.message);
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [
    reportId,
    meta.team.id,
    meta.current_user,
    meta.role,
    meta.mode,
    revision,
  ]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  function refresh() {
    setRevision((value) => value + 1);
    onChange();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="detail-dialog">
        {error && (
          <div className="calendar-error" role="alert">
            {tr(error)}{" "}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRevision((value) => value + 1)}
            >
              {tr("重试")}
            </Button>
          </div>
        )}
        {report ? (
          <ReportDetail
            report={report}
            meta={meta}
            collaborations={collaborations}
            onChange={refresh}
            onSaved={setNotice}
            onDeleted={() => {
              onClose();
              onChange();
            }}
          />
        ) : (
          <div className="detail-body">
            <DialogTitle className="detail-title">{tr("简报详情")}</DialogTitle>
            <DialogDescription className="sr-only">
              {tr("查看简报内容与讨论。")}
            </DialogDescription>
            {loading && (
              <span role="status" aria-label={tr("加载中…")}>
                <LoaderCircle className="calendar-loading-icon" size={20} />
              </span>
            )}
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <Check size={17} />
            {tr(notice)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
