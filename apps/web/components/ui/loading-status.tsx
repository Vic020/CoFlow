"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "../i18n-provider";

/** A permanent slot: async state changes visibility, never layout. */
export function LoadingStatus({
  active,
  className = "",
}: {
  active: boolean;
  className?: string;
}) {
  const { t: tr } = useI18n();
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!active) {
      setDelayed(false);
      return;
    }
    const timer = setTimeout(() => setDelayed(true), 150);
    return () => clearTimeout(timer);
  }, [active]);
  const visible = active && delayed;
  return (
    <span
      className={`loading-status${visible ? " is-active" : ""} ${className}`}
      aria-hidden={!visible || undefined}
    >
      <Loader2 size={16} aria-hidden="true" />
      <span className="sr-only" role="status">
        {visible ? tr("加载中…") : ""}
      </span>
    </span>
  );
}

/** First-read frame only. Refreshes keep the previously successful content. */
export function PageLoading({
  active = true,
  indicator = true,
}: {
  active?: boolean;
  indicator?: boolean;
}) {
  return (
    <div className="page-loading-shell" aria-busy={active}>
      {indicator && (
        <LoadingStatus active={active} className="page-loading-indicator" />
      )}
    </div>
  );
}
