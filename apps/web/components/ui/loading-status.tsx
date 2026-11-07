"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../i18n-provider";

/** Background activity keeps its reserved slot; first reads use content skeletons. */
export function LoadingStatus({
  active,
  className = "",
}: {
  active: boolean;
  className?: string;
}) {
  const { t } = useI18n();
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
      <span className="loading-progress" aria-hidden="true" />
      <span className="sr-only" role="status">
        {visible ? t("加载中…") : ""}
      </span>
    </span>
  );
}

type Layout =
  | "list"
  | "timeline"
  | "board"
  | "calendar"
  | "week"
  | "gantt"
  | "settings"
  | "workspace";
const blocks = (n: number) => Array.from({ length: n }, (_, i) => i);
function Line({ short = false }: { short?: boolean }) {
  return <span className={`skeleton-line${short ? " is-short" : ""}`} />;
}
function Rows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-rows">
      {blocks(rows).map((i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton-avatar" />
          <div>
            <Line />
            <Line short />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Structural, decorative placeholders. Never use them to cover valid refreshed data. */
export function ContentSkeleton({
  variant = "list",
  rows = 3,
}: {
  variant?: Layout;
  rows?: number;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`content-skeleton content-skeleton--${variant}`}
      role="status"
      aria-label={t("加载中…")}
    >
      <div aria-hidden="true">
        {variant === "board" ? (
          <div className="skeleton-board">
            {blocks(4).map((i) => (
              <div className="skeleton-lane" key={i}>
                <Line short />
                <Rows rows={(i % 2) + 2} />
              </div>
            ))}
          </div>
        ) : variant === "gantt" ? (
          <div className="skeleton-gantt">
            {blocks(7).map((i) => (
              <div className="skeleton-gantt-row" key={i}>
                <Line short />
                <div style={{ paddingInlineStart: `${(i % 3) * 12}%` }}>
                  <Line />
                </div>
              </div>
            ))}
          </div>
        ) : variant === "calendar" || variant === "week" ? (
          <div className="skeleton-calendar">
            <div className="skeleton-weekdays">
              {blocks(7).map((i) => (
                <Line key={i} short />
              ))}
            </div>
            <div className="skeleton-days">
              {blocks(variant === "week" ? 84 : 35).map((i) => (
                <div key={i}>
                  <Line short />
                  {i % 3 === 0 && <Line />}
                </div>
              ))}
            </div>
          </div>
        ) : variant === "settings" ? (
          <div className="skeleton-settings">
            <div>
              {blocks(4).map((i) => (
                <Line key={i} />
              ))}
            </div>
            <Rows rows={rows} />
          </div>
        ) : variant === "workspace" ? (
          <div className="skeleton-workspace">
            <div className="skeleton-nav">
              <Line />
              {blocks(5).map((i) => (
                <Line key={i} short />
              ))}
            </div>
            <div>
              <div className="skeleton-heading">
                <Line short />
              </div>
              <Rows rows={4} />
            </div>
          </div>
        ) : (
          <Rows rows={rows} />
        )}
      </div>
    </div>
  );
}

export function PageLoading({
  active = true,
  variant = "timeline",
}: {
  active?: boolean;
  variant?: Layout;
}) {
  return (
    <div className="page-loading-shell" aria-busy={active}>
      {active && <ContentSkeleton variant={variant} />}
    </div>
  );
}
