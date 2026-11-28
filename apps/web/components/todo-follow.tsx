"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { request } from "@/lib/types";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";

export function TodoFollow({ id }: { id: string }) {
  const { t } = useI18n();
  const [following, setFollowing] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `/todos/${encodeURIComponent(id)}/follow`;
  useEffect(() => {
    let active = true;
    void request<{ following: boolean }>(path)
      .then((result) => {
        if (active) setFollowing(result.following);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path]);
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={following}
        disabled={busy || following === undefined}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await request<{ following: boolean }>(path, {
              method: "PUT",
              body: JSON.stringify({ following: !following }),
            });
            setFollowing(result.following);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {following ? <BellOff size={14} /> : <Bell size={14} />}
        {t(following ? "取消关注" : "关注任务")}
      </Button>
      {error && (
        <small role="alert" className="error-text">
          {t(error)}
        </small>
      )}
    </div>
  );
}
