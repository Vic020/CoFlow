"use client";

import { useState } from "react";
import { browserOperation } from "@/lib/cli-browser-operation";
import { useAuth } from "./auth-gate";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { request } from "@/lib/types";

type CLIRequest = {
  command: string;
  method: string;
  path: string;
  server: string;
  team_id: string;
  user_id: string;
  body?: Record<string, unknown>;
};

function parseRequest(input: string): CLIRequest {
  const value = JSON.parse(input);
  if (!value || !browserOperation(value.command, value.method, value.path)
    || typeof value.server !== "string" || !value.team_id || !value.user_id
    || (value.body !== undefined && (!value.body || typeof value.body !== "object" || Array.isArray(value.body)))) {
    throw new Error();
  }
  const server = new URL(value.server);
  if (server.origin !== window.location.origin || server.username || server.password
    || server.pathname !== "/" || server.search || server.hash) throw new Error();
  return value;
}

export function CLIRequestReview() {
  const { t } = useI18n();
  const { me } = useAuth();
  const [input, setInput] = useState("");
  const [review, setReview] = useState<CLIRequest | null>(null);
  const [result, setResult] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const team = me?.teams.find(({ id }) => id === me.current_team);
  const matches = review && review.user_id === me?.user.id && review.team_id === team?.id;

  async function confirm() {
    if (!review || !matches || busy) return;
    setBusy(true);
    setResult("");
    setFailed(false);
    try {
      const response = await request(review.path, {
        method: review.method,
        headers: { "X-CoFlow-CLI-User": review.user_id, "X-CoFlow-CLI-Team": review.team_id },
        body: review.body === undefined ? undefined : JSON.stringify(review.body),
      });
      setResult(JSON.stringify(response, null, 2));
      setReview(null);
      setInput("");
    } catch (error) {
      setReview(null);
      setFailed(true);
      setResult((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="token-form" onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setReview(null);
        setFailed(false);
        setResult("");
        try {
          setReview(parseRequest(input));
        } catch {
          setFailed(true);
          setResult("无法识别这份请求。请检查是否来自当前站点的 CoFlow CLI。");
        }
      }}>
        <label>
          {t("粘贴终端生成的请求")}
          <textarea rows={3} required value={input} disabled={busy} onChange={(event) => {
            setInput(event.target.value);
            setReview(null);
            setResult("");
          }} />
        </label>
        <Button type="submit" disabled={busy}>{t("查看请求")}</Button>
      </form>
      {review && (
        <section>
          <p>{t("账号与空间")} · {me?.user.name} · {team?.name}</p>
          <p>{review.command} · {review.method} {review.path}</p>
          {review.body && <pre>{JSON.stringify(review.body, (key, value) =>
            /secret|password|credential|token|api_key|authorization/i.test(key) ? "••••••" : value, 2)}</pre>}
          {!matches && <p role="alert">{t("请切换到请求中指定的账号与空间。")}</p>}
          <Button type="button" disabled={busy || !matches} onClick={() => void confirm()}>{t("用当前账号执行")}</Button>
        </section>
      )}
      {result && (failed
        ? <p role="alert" className="error-text">{t(result)}</p>
        : <pre aria-label={t("执行结果")}>{result}</pre>)}
    </>
  );
}
