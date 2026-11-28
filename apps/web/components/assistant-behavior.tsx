"use client";

import { useEffect, useState } from "react";
import { publicDemo } from "@/lib/runtime";
import { request } from "@/lib/types";
import { useAuth } from "./auth-gate";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { ContentSkeleton } from "./ui/loading-status";

type Behavior = {
  model_retries: number;
  system_prompt_append: string;
  revision: number;
};

export function AssistantBehavior() {
  const { t } = useI18n();
  const { mode } = useAuth();
  const [settings, setSettings] = useState<Behavior>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const demo = publicDemo || mode === "local-demo";

  useEffect(() => {
    if (demo) return;
    let active = true;
    void request<Behavior>("/assistant/behavior")
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [demo, reload]);

  if (demo) return <p className="muted">{t("演示模式不保存助手行为。")}</p>;
  if (!settings)
    return error ? (
      <>
        <p role="alert">{t(error)}</p>
        <Button
          variant="outline"
          onClick={() => {
            setError("");
            setReload(reload + 1);
          }}
        >
          {t("重试")}
        </Button>
      </>
    ) : (
      <ContentSkeleton />
    );

  const tooLong =
    new TextEncoder().encode(settings.system_prompt_append.trim()).length >
    6000;
  return (
    <form
      className="ai-config-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || tooLong) return;
        setBusy(true);
        setSaved(false);
        setError("");
        try {
          setSettings(
            await request<Behavior>("/assistant/behavior", {
              method: "PATCH",
              body: JSON.stringify(settings),
            }),
          );
          setSaved(true);
        } catch (failure) {
          setError((failure as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {t("模型自动重试次数")}
        <select
          value={settings.model_retries}
          disabled={busy}
          onChange={(event) => {
            setSaved(false);
            setSettings({
              ...settings,
              model_retries: Number(event.target.value),
            });
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        {t(
          "默认 2 次。仅在模型服务返回限流或暂时不可用时重试，额外请求可能计费。",
        )}
      </p>
      <label>
        {t("追加系统提示词")}
        <textarea
          rows={5}
          value={settings.system_prompt_append}
          disabled={busy}
          onChange={(event) => {
            setSaved(false);
            setSettings({
              ...settings,
              system_prompt_append: event.target.value,
            });
          }}
        />
      </label>
      <p className="muted">
        {t(
          "追加到系统默认提示词之后。可填写回答风格、输出格式和工作约定。留空即使用默认提示词。",
        )}
      </p>
      {tooLong && <p role="alert">{t("追加提示词最多 6000 字节")}</p>}
      {error && <p role="alert">{t(error)}</p>}
      <div className="ai-manager-row">
        <Button type="submit" disabled={busy || tooLong}>
          {t(saved ? "已保存" : "保存")}
        </Button>
      </div>
    </form>
  );
}
