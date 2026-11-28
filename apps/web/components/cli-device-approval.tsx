"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "./auth-gate";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { request } from "@/lib/types";

type Review = {
  name: string;
  scopes: string[];
  days: number;
  project_id?: string;
  todo_id?: string;
  user_id: string;
  team_id: string;
};

const scopes: Record<string, string> = {
  "reports:read": "查看简报",
  "reports:write": "提交和修改简报",
  "comments:write": "发表评论",
  "todos:read": "查看任务",
  "todos:write": "更新任务",
  "calendar:read": "查看日程",
  "calendar:write": "更新日程",
  "context:read": "查看 Context",
  "context:write": "更新 Context",
};

export function CLIDeviceApproval({
  onRefresh,
}: {
  onRefresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { me } = useAuth();
  const [code, setCode] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const team = me?.teams.find(({ id }) => id === me.current_team);
  const matches =
    review && review.user_id === me?.user.id && review.team_id === team?.id;

  async function check() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      setReview(
        await request<Review>("/cli/device/review", {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
      );
    } catch {
      setError("无法查看这次授权。请检查配对码或在终端重新开始。");
    } finally {
      setBusy(false);
    }
  }

  async function decide(approve: boolean) {
    if (!review || !matches) return;
    setBusy(true);
    setError("");
    try {
      await request("/cli/device/decision", {
        method: "POST",
        body: JSON.stringify({
          code,
          user_id: review.user_id,
          team_id: review.team_id,
          approve,
        }),
      });
      setReview(null);
      setCode("");
      setResult(
        approve ? "已允许。回到终端继续，之后可在此页撤销凭证。" : "已拒绝。",
      );
    } catch {
      setReview(null);
      setError("授权未完成。请重新查看配对码。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="cli-connection">
      <div className="credentials-list-heading">
        <h2>{t("连接 CLI")}</h2>
        <Link href="/cli" className="report-text-link">
          {t("CLI 下载与接入")}
        </Link>
      </div>
      <p className="credential-guidance">
        {t("仅输入你刚刚在自己终端看到的配对码。")}
      </p>
      <form
        className="token-form"
        onSubmit={(event) => {
          event.preventDefault();
          void check();
        }}
      >
        <label>
          {t("终端配对码")}
          <input
            autoComplete="off"
            spellCheck={false}
            value={code}
            maxLength={9}
            pattern="[A-Za-z2-3]{4}-?[A-Za-z2-3]{4}"
            placeholder="XXXX-XXXX"
            disabled={busy}
            required
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setReview(null);
              setError("");
              setResult("");
            }}
          />
        </label>
        <Button type="submit" disabled={busy || Boolean(review)}>
          {t("查看授权")}
        </Button>
      </form>
      {review && (
        <div>
          <p>
            {review.name} · {t("有效期 {count} 天", { count: review.days })}
          </p>
          <p>
            {t("账号与空间")} · {me?.user.name} ({me?.user.email}) ·{" "}
            {team?.name}
          </p>
          {review.project_id && (
            <p>
              {t("项目 ID")} · {review.project_id}
            </p>
          )}
          {review.todo_id && (
            <p>
              {t("任务 ID")} · {review.todo_id}
            </p>
          )}
          <p>
            {review.scopes
              .map((scope) => t(scopes[scope] ?? scope))
              .join(" · ")}
          </p>
          <Button
            type="button"
            disabled={!matches || busy}
            onClick={() => void decide(true)}
          >
            {t("允许 CLI 访问")}
          </Button>{" "}
          <Button
            type="button"
            variant="outline"
            disabled={!matches || busy}
            onClick={() => void decide(false)}
          >
            {t("拒绝")}
          </Button>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {t(error)}
        </p>
      )}
      {result && <p role="status">{t(result)}</p>}
      {result.startsWith("已允许") && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void onRefresh()}
        >
          {t("刷新凭证列表")}
        </Button>
      )}
    </section>
  );
}
