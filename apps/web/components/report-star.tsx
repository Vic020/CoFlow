"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { listActivityFollows, setActivityFollow } from "@/lib/activity-follows";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";

export function ReportStar({ id }: { id: string }) {
  const { t } = useI18n();
  const [starred, setStarred] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void listActivityFollows().then(({ items }) => {
      if (active) setStarred(items.some((item) => item.kind === "report" && item.target_id === id));
    }).catch((failure: Error) => {
      if (active) setError(failure.message);
    });
    return () => { active = false; };
  }, [id]);

  async function toggle() {
    if (starred === undefined || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await setActivityFollow("report", id, !starred);
      setStarred(result.following);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="report-star-button"
        aria-pressed={starred === true} disabled={starred === undefined || busy} onClick={() => void toggle()}>
        <Star size={14} fill={starred ? "currentColor" : "none"} />
        {t("关注")}
      </Button>
      {error && <span role="alert" className="error-text">{t(error)}</span>}
    </>
  );
}
